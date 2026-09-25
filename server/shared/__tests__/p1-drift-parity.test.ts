/**
 * P1-1 跨语言一致性：TypeScript 的 PSI 必须等于 Python 算出的 PSI。
 *
 * 为什么必须有这条：漂移监控两侧口径若不同，会出现「看板说稳定、离线脚本说漂移」——
 * 这比没有监控更糟，因为它让人相信一个错的结论。
 *
 * 实现方式（刻意选择"固定样本 + 固定期望值"，而不是在测试里启动 Python）：
 *   · 本会话的沙箱禁止 Node 以管道 stdio 启动子进程（spawn EPERM），
 *     orchestrating a Python 子进程的守卫在这里必然失败；
 *   · 更根本的是：让守卫依赖"本机恰好装了 Python"本身就是脆弱设计 ——
 *     CI 一旦静默跳过，守卫等于不存在。
 *   因此把 Python 的实现输出固化成 `server-ml/drift-parity-fixture.json`（由
 *   `feature_drift_cli.py --emit-fixture` 生成，含逐特征期望 PSI），
 *   测试只做"用 TS 重算 → 必须等于 Python 记录的期望值"。
 *
 * ⚠️ 维护约定：**改动 Python 或 TS 任一侧的 PSI/分箱逻辑后必须重新生成夹具**，
 *    否则这条守卫会在两侧都"自洽"的情况下失效：
 *      python server-ml/feature_drift_cli.py --emit-fixture server-ml/drift-parity-fixture.json
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  actualProportions,
  binIndex,
  driftReport,
  loadBaseline,
  psi
} from "../../src/services/featureDrift.js";

const SERVER_ML = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "server-ml"
);
const FIXTURE = path.join(SERVER_ML, "drift-parity-fixture.json");

interface ParityFixture {
  generatedBy: string;
  note: string;
  regenerate: string;
  samples: number;
  features: Array<{
    feature: string;
    live: number[];
    pythonPsi: number;
    pythonProportions: number[];
  }>;
}

function readFixture(): ParityFixture {
  expect(
    fs.existsSync(FIXTURE),
    `跨语言夹具缺失：${FIXTURE}（重新生成命令写在用例注释里）`
  ).toBe(true);
  return JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as ParityFixture;
}

describe("P1-1 PSI 跨语言一致性（TS 重算 ⇄ Python 记录值）", () => {
  it("夹具必须声明来源与再生成命令（否则它是不可复现的黑盒）", () => {
    const fx = readFixture();
    expect(fx.generatedBy).toContain("feature_drift_cli.py");
    expect(fx.regenerate).toContain("--emit-fixture");
    expect(fx.features).toHaveLength(15);
    expect(fx.samples).toBeGreaterThanOrEqual(100);
  });

  it("15 个特征：TS 重算的 PSI 与 Python 记录值一致（1e-9）", () => {
    const fx = readFixture();
    const baseline = loadBaseline();
    expect(baseline, "基线产物缺失，无法做跨语言比对").not.toBeNull();
    const byFeature = new Map(baseline!.features.map(r => [r.feature, r]));

    let compared = 0;
    let max = 0;
    for (const item of fx.features) {
      const ref = byFeature.get(item.feature);
      expect(ref, `基线缺少 ${item.feature}`).toBeTruthy();
      const act = actualProportions(item.live, ref!.bin_edges);
      // 逐箱占比也必须一致：PSI 相同但分箱不同，说明两边用了不同边界
      for (let i = 0; i < act.length; i += 1) {
        expect(
          Math.abs(act[i] - item.pythonProportions[i]),
          `${item.feature} 第 ${i} 箱占比不一致（分箱边界可能已漂移）`
        ).toBeLessThan(1e-9);
      }
      const tsPsi = psi(ref!.proportions, act);
      expect(
        Math.abs(tsPsi - item.pythonPsi),
        `${item.feature}: TS=${tsPsi} Python=${item.pythonPsi}`
      ).toBeLessThan(1e-9);
      max = Math.max(max, tsPsi);
      compared += 1;
    }
    expect(compared).toBe(15);
    // 防止夹具退化成"两边都是 0"的假通过
    expect(max).toBeGreaterThan(0);
  });

  it("同一批 live 值经完整报告路径（driftReport）得到同一结论", () => {
    const fx = readFixture();
    const live = Object.fromEntries(fx.features.map(f => [f.feature, f.live]));
    const report = driftReport(live, 30);
    expect(report.available).toBe(true);
    expect(report.samples).toBe(fx.samples);
    // 报告对外只保留 4 位小数（前端展示精度），夹具存的是全精度 → 比到 4 位
    const pyMax = Math.max(...fx.features.map(f => f.pythonPsi));
    expect(report.maxPsi).toBeCloseTo(pyMax, 4);
    // 逐特征同样比到 4 位，且最差特征要一致
    const pyWorst = fx.features.reduce((a, b) =>
      b.pythonPsi > a.pythonPsi ? b : a
    );
    expect(report.maxPsiFeature).toBe(pyWorst.feature);
    for (const item of report.features) {
      const py = fx.features.find(f => f.feature === item.feature)!;
      expect(item.psi, `${item.feature} 报告值应为 null 或数值`).not.toBeNull();
      expect(item.psi as number).toBeCloseTo(py.pythonPsi, 4);
    }
  });

  it("binIndex 的越界语义：低于首边界归 0，高于末边界归最后一箱", () => {
    const edges = [0, 10, 20, 30];
    expect(binIndex(-5, edges)).toBe(0);
    expect(binIndex(0, edges)).toBe(0);
    expect(binIndex(9.99, edges)).toBe(0);
    expect(binIndex(10, edges)).toBe(1);
    expect(binIndex(25, edges)).toBe(2);
    expect(binIndex(30, edges)).toBe(2);
    expect(binIndex(999, edges)).toBe(2);
    // 退化边界（常量列）不得抛错
    expect(binIndex(5, [4.5, 5.5])).toBe(0);
    expect(binIndex(5, [])).toBe(0);
  });
});
