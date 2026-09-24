/**
 * C2 模拟设备同步路由：`POST /api/health/device/sync`。
 *
 * 入参：`{ device: string, measurements: [{ metric, value, measuredAt }] }`
 * 出参：按日期分组落库的记录 + 质量分布 + 逐条质量问题说明。
 *
 * 解析与质量判定全部委托共享层 `@shared/health-quality`（唯一源码，前端同一份），
 * 本文件只负责：鉴权 → 调用共享解析 → 用统一写入函数落库 → 组装响应。
 *
 * 一处需要说明的行为：同一天若已有记录（手动或其他来源），本接口**追加**一条而不覆盖 ——
 * 覆盖会改写用户手动录入的数据，风险高于收益。规则引擎取「最新一条」（date 相同比 id），
 * 因此设备新同步的记录会自然成为当日最新。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  SOURCE_LABELS,
  buildDeviceRecords
} from "../../../shared/health-quality.js";
import {
  RECORD_INSERT_SQL,
  RECORD_SELECT,
  buildRecordValues,
  profileHeight,
  toRecord
} from "./common.js";
import type { RecordRow } from "./common.js";
// C5：设备同步留痕
import { actorOf, writeAudit } from "./audit.js";

const router = Router();

/**
 * POST /api/health/device/sync —— 模拟设备上报一批测量值。
 *
 * 校验（不通过一律 400，整批不落库，避免半批数据入库）：
 * - `device` 非空字符串；`measurements` 非空数组；
 * - 每条须带可识别的 `metric`（含 sbp/tg/spo2 等常见别名与中文名）、数字 `value`、
 *   可解析的 `measuredAt`（兼容 `yyyy-MM-dd` / `yyyy-MM-dd HH:mm[:ss]` / ISO 的 T 分隔）。
 *
 * 落库口径：一天一条（按 measuredAt 的日期分组，同日同指标后报覆盖先报），
 * 来源固定 `device`、设备名写入 `device_name`、测量时间写入 `measured_at`，
 * 质量标记由共享层按合理区间现算（超出合理区间 → suspect，绝无可能的值 → invalid）。
 */
router.post("/health/device/sync", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const height = profileHeight(userId);
  const { records, error } = buildDeviceRecords(
    body.device,
    body.measurements,
    height
  );
  if (error) {
    // C5：被拒绝的批次同样留痕（只记原因与上报条数，不含上报数值）
    writeAudit(
      "device_sync",
      {
        device: String(body.device ?? "").slice(0, 60),
        received: Array.isArray(body.measurements)
          ? body.measurements.length
          : 0,
        saved: 0,
        rejected: true
      },
      actorOf(req)
    );
    res.status(400).json({ code: 40001, message: error });
    return;
  }

  // 共享解析已保证指标值都是数字，故 buildRecordValues 不会返回格式错误
  const prepared = records.map(draft => {
    const { values } = buildRecordValues(draft.metrics, userId, draft.date, {
      sourceType: "device",
      deviceName: draft.device,
      measuredAt: draft.measuredAt,
      height
    });
    return values;
  });

  const insert = db.prepare(RECORD_INSERT_SQL);
  const ids = db.transaction((rows: Array<Record<string, unknown>>) => {
    const out: Array<number> = [];
    for (const row of rows) out.push(Number(insert.run(row).lastInsertRowid));
    return out;
  })(prepared);

  const findOne = db.prepare(`${RECORD_SELECT} WHERE id = ? AND user_id = ?`);
  const saved = ids.map(id => toRecord(findOne.get(id, userId) as RecordRow));

  const flagCount = (flag: string) =>
    prepared.filter(v => v.quality_flag === flag).length;

  // C5：设备同步留痕（只记设备名 / 上报与入库条数 / 质量分布，不含任何指标数值）
  writeAudit(
    "device_sync",
    {
      device: String(body.device ?? "")
        .trim()
        .slice(0, 60),
      received: Array.isArray(body.measurements) ? body.measurements.length : 0,
      saved: saved.length,
      good: flagCount("good"),
      suspect: flagCount("suspect"),
      invalid: flagCount("invalid")
    },
    actorOf(req)
  );

  res.json({
    code: 0,
    message: "操作成功",
    data: {
      device: String(body.device ?? "").trim(),
      sourceType: "device",
      sourceLabel: SOURCE_LABELS.device,
      /** 实际入库条数（按日期分组后可能少于上报条数） */
      saved: saved.length,
      /** 上报条数 */
      received: Array.isArray(body.measurements) ? body.measurements.length : 0,
      quality: {
        good: flagCount("good"),
        suspect: flagCount("suspect"),
        invalid: flagCount("invalid")
      },
      /** 逐条质量问题说明（前端黄色提示直接展示） */
      issues: records.map(draft => ({
        date: draft.date,
        device: draft.device,
        qualityFlag: draft.qualityFlag,
        messages: draft.issues.map(it => it.message)
      })),
      records: saved
    }
  });
});

export default router;
