"""
漂移口径的两个命令行入口：

1. `--live-file`：把线上特征值（JSON: {feature: [values...]}）喂给 Python 侧 PSI 实现并打印结果。
   用于人工排查「看板显示的 PSI 是怎么算出来的」。

2. `--emit-fixture`：生成跨语言一致性夹具 `drift-parity-fixture.json`。
   TS 侧 `server/shared/__tests__/p1-drift-parity.test.ts` 会用同一批 live 值重算，
   断言与这里记录的 `pythonPsi` 完全一致。

   ⚠️ 夹具是**固化输出**而不是在测试里启动 Python，原因有二：
      a) 测试环境可能根本没有 Python（CI），一旦静默跳过，守卫就等于不存在；
      b) Node 沙箱禁止管道 stdio 启动子进程时也能跑。
   代价：改动任一侧 PSI/分箱逻辑后**必须重新生成夹具**，否则守卫失真。

用法：
  python server-ml/feature_drift_cli.py --live-file <values.json> [--json-out <out.json>]
  python server-ml/feature_drift_cli.py --emit-fixture server-ml/drift-parity-fixture.json
"""
from __future__ import annotations
import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from feature_drift import (  # noqa: E402
    actual_proportions,
    drift_report,
    load_baseline,
    psi,
)

SAMPLES_PER_FEATURE = 500
FIXTURE_SEED = 20260925


def _lcg(seed: int):
    """固定线性同余发生器，与 TS 侧同参数，保证夹具可复现。"""
    state = seed & 0xFFFFFFFF

    def nxt() -> float:
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state / 0x100000000

    return nxt


def emit_fixture(out_path: str) -> dict:
    base = load_baseline()
    rand = _lcg(FIXTURE_SEED)
    features = []
    for ref in base["features"]:
        edges = ref["bin_edges"]
        mids = [(edges[i] + edges[i + 1]) / 2 for i in range(len(edges) - 1)]
        cumulative = []
        acc = 0.0
        for p in ref["proportions"]:
            acc += p
            cumulative.append(acc)
        live = []
        for i in range(SAMPLES_PER_FEATURE):
            r = rand()
            idx = next((j for j, c in enumerate(cumulative) if r <= c), len(mids) - 1)
            live.append(round(mids[idx] + i * 1e-4, 6))
        props = actual_proportions(live, edges)
        features.append(
            {
                "feature": ref["feature"],
                "live": live,
                "pythonPsi": round(psi(ref["proportions"], props), 12),
                "pythonProportions": [round(p, 12) for p in props],
            }
        )

    fixture = {
        "generatedBy": "server-ml/feature_drift_cli.py --emit-fixture",
        "note": (
            "TS 侧 p1-drift-parity.test.ts 用这里的 live 值重算 PSI，"
            "必须等于 pythonPsi。改动任一侧 PSI/分箱逻辑后请重新生成本文件。"
        ),
        "regenerate": (
            "python server-ml/feature_drift_cli.py --emit-fixture "
            "server-ml/drift-parity-fixture.json"
        ),
        "baselineVersion": base.get("baseline_version"),
        "seed": FIXTURE_SEED,
        "samples": SAMPLES_PER_FEATURE,
        "features": features,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=2)
    return fixture


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live-file", default=None, help="线上特征值 JSON")
    ap.add_argument("--json-out", default=None, help="把完整报告写到该文件")
    ap.add_argument("--emit-fixture", default=None, help="生成跨语言一致性夹具到该路径")
    args = ap.parse_args()

    if args.emit_fixture:
        fx = emit_fixture(args.emit_fixture)
        print(
            f"[fixture] 已写入 {args.emit_fixture}"
            f"（{len(fx['features'])} 个特征 × {fx['samples']} 个样本）"
        )
        return 0

    if not args.live_file:
        ap.error("需要 --live-file 或 --emit-fixture")

    with open(args.live_file, encoding="utf-8") as f:
        live = {k: [float(x) for x in v] for k, v in json.load(f).items()}

    report = drift_report(live, load_baseline())
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    print(
        f"[drift] samples={report['samples']} level={report['level']} "
        f"maxPsi={report['maxPsi']}"
    )
    for item in report["features"]:
        if item["psi"] is None:
            continue
        print(f"  {item['feature']:22s} psi={item['psi']:.6f} n={item['samples']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
