/**
 * V2.1 P1-1a：大学生生活方式调研路由。
 * GET  /api/health/survey/latest 最近一次问卷
 * POST /api/health/survey          提交问卷并打规则标签
 * GET  /api/health/survey/dataset-status  训练数据集现状（真实样本数 / 切换条件）
 * POST /api/health/survey/export-dataset  导出可直接喂 train.py 的真实数据集
 *
 * 标签仅用于模型冷启动训练，不构成医学诊断。
 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import db from "../../db.js";
import { authMiddleware, adminOnly } from "../../middleware/auth.js";
import { labelSurvey } from "../../services/survey-label.js";
import { mlDir } from "../../paths.js";

const router = Router();

interface SurveyRow {
  id: number;
  user_id: number;
  survey_version: string;
  sleep_hours_avg: number | null;
  sleep_quality: number | null;
  stay_up_freq: number | null;
  study_pressure: number | null;
  exam_pressure: number | null;
  mood_state: number | null;
  exercise_times: number | null;
  exercise_min: number | null;
  breakfast: number | null;
  diet_regular: number | null;
  sedentary_hours: number | null;
  phone_hours: number | null;
  risk_score: number;
  lifestyle_risk_label: string;
  is_anonymous: number;
  created_at: string;
}

const NUM = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

router.get("/health/survey/latest", authMiddleware, (req, res) => {
  const row = db
    .prepare(
      "SELECT * FROM health_survey WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(req.user!.id) as SurveyRow | undefined;
  res.json({
    code: 0,
    message: "操作成功",
    data: { completed: !!row, data: row ?? null }
  });
});

router.post("/health/survey", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const b = (req.body ?? {}) as Record<string, unknown>;

  const input = {
    sleep_hours_avg: NUM(b.sleep_hours_avg),
    stay_up_freq: NUM(b.stay_up_freq),
    study_pressure: NUM(b.study_pressure),
    exercise_times: NUM(b.exercise_times),
    diet_regular: NUM(b.diet_regular),
    sedentary_hours: NUM(b.sedentary_hours)
  };
  const { score, label } = labelSurvey(input);

  db.prepare(
    `INSERT INTO health_survey
      (user_id, survey_version, sleep_hours_avg, sleep_quality, stay_up_freq,
       study_pressure, exam_pressure, mood_state, exercise_times, exercise_min,
       breakfast, diet_regular, sedentary_hours, phone_hours,
       risk_score, lifestyle_risk_label, is_anonymous)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    userId,
    "v1",
    input.sleep_hours_avg,
    NUM(b.sleep_quality),
    input.stay_up_freq,
    input.study_pressure,
    NUM(b.exam_pressure),
    NUM(b.mood_state),
    input.exercise_times,
    NUM(b.exercise_min),
    NUM(b.breakfast),
    input.diet_regular,
    input.sedentary_hours,
    NUM(b.phone_hours),
    score,
    label,
    b.is_anonymous ? 1 : 0
  );

  res.json({
    code: 0,
    message: "感谢参与健康调研",
    data: { score, label }
  });
});

// ---------- ML-03：真实训练数据的采集 → 训练闭环 ----------

/**
 * 训练数据集现状。
 *
 * 为什么要有这个接口：`train.py` 有真实样本时会自动把 training_mode 从 synthetic_only
 * 切到 hybrid_training(≥20) / real_priority(≥100)，但前端此前完全看不到这条门槛，
 * 评委也无从判断"这个模型到底用了多少真数据"。这里把门槛和缺口如实算出来。
 */
const REAL_MODE_THRESHOLD = { hybrid: 20, priority: 100 } as const;

function countLabeled(): number {
  const r = db
    .prepare(
      "SELECT COUNT(*) c FROM health_survey WHERE lifestyle_risk_label IN ('low','medium','high')"
    )
    .get() as { c: number };
  return r.c;
}

router.get("/health/survey/dataset-status", authMiddleware, (_req, res) => {
  const real = countLabeled();
  const nextMode =
    real >= REAL_MODE_THRESHOLD.priority
      ? "real_priority"
      : real >= REAL_MODE_THRESHOLD.hybrid
        ? "hybrid_training"
        : "synthetic_only";
  const need =
    real >= REAL_MODE_THRESHOLD.priority
      ? 0
      : real >= REAL_MODE_THRESHOLD.hybrid
        ? REAL_MODE_THRESHOLD.priority - real
        : REAL_MODE_THRESHOLD.hybrid - real;
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      realSamples: real,
      nextTrainingMode: nextMode,
      /** 再采集多少条真实问卷，下次训练就会切换到 nextTrainingMode */
      needMore: need,
      thresholds: REAL_MODE_THRESHOLD,
      /** 标签口径说明，避免被误读成医学标注 */
      labelSource: "规则引擎 lifestyle_risk_label（生活方式风险，非医学诊断）"
    }
  });
});

/**
 * 导出真实数据集（SQLite），内容与 server-ml/dataset.py 的 load_real_dataset 完全同构，
 * 导出后可直接：
 *     python server-ml/train.py --real-db <导出的路径>
 *     python server-ml/clustering.py --real-db <导出的路径>
 *
 * 之所以导 SQLite 而不是 JSON：dataset.py 读的就是 SQLite，中间不再加一层格式转换，
 * 避免"导出格式与训练脚本读的口径不一致"这类只有跑了才发现的问题。
 */
const EXPORT_COLS = [
  "id",
  "user_id",
  "survey_version",
  "sleep_hours_avg",
  "sleep_quality",
  "stay_up_freq",
  "study_pressure",
  "exam_pressure",
  "mood_state",
  "exercise_times",
  "exercise_min",
  "breakfast",
  "diet_regular",
  "sedentary_hours",
  "phone_hours",
  "risk_score",
  "lifestyle_risk_label",
  "is_anonymous",
  "created_at"
] as const;

router.post(
  "/health/survey/export-dataset",
  authMiddleware,
  adminOnly,
  (_req, res) => {
    const rows = db
      .prepare(
        `SELECT ${EXPORT_COLS.join(", ")} FROM health_survey
          WHERE lifestyle_risk_label IN ('low','medium','high')
          ORDER BY id`
      )
      .all() as Array<Record<string, unknown>>;

    if (!rows.length) {
      res.json({
        code: 1,
        message:
          "暂无带标签的真实问卷，请先到「健康调研」页面提交问卷再导出；未达 20 条也不会进入混合训练"
      });
      return;
    }

    // 写到 server-ml 下，与训练脚本同目录；路径同样不依赖 cwd
    const outPath = path.join(mlDir(), "real_survey.db");
    const tmp = `${outPath}.tmp`;
    fs.rmSync(tmp, { force: true });

    // 写一份最小可读的 SQLite，字段与源表一致
    const out = new Database(tmp);
    out.pragma("journal_mode = DELETE");
    out.exec(
      `CREATE TABLE health_survey (
         id INTEGER PRIMARY KEY,
         user_id INTEGER,
         survey_version TEXT,
         sleep_hours_avg REAL,
         sleep_quality REAL,
         stay_up_freq REAL,
         study_pressure REAL,
         exam_pressure REAL,
         mood_state REAL,
         exercise_times REAL,
         exercise_min REAL,
         breakfast REAL,
         diet_regular REAL,
         sedentary_hours REAL,
         phone_hours REAL,
         risk_score REAL,
         lifestyle_risk_label TEXT,
         is_anonymous INTEGER,
         created_at TEXT
       )`
    );
    const cols = EXPORT_COLS.map(c => `"${c}"`).join(", ");
    const marks = EXPORT_COLS.map(() => "?").join(", ");
    const ins = out.prepare(
      `INSERT INTO health_survey (${cols}) VALUES (${marks})`
    );
    for (const r of rows) ins.run(EXPORT_COLS.map(c => r[c] ?? null));
    out.close();

    fs.renameSync(tmp, outPath);

    const dist = db
      .prepare(
        "SELECT lifestyle_risk_label l, COUNT(*) c FROM health_survey WHERE lifestyle_risk_label IN ('low','medium','high') GROUP BY l"
      )
      .all() as Array<{ l: string; c: number }>;

    res.json({
      code: 0,
      message: "真实数据集已导出",
      data: {
        path: outPath,
        realSamples: rows.length,
        distribution: {
          low: dist.find(d => d.l === "low")?.c ?? 0,
          medium: dist.find(d => d.l === "medium")?.c ?? 0,
          high: dist.find(d => d.l === "high")?.c ?? 0
        },
        /** 与 train.py 的 mode 判定保持同一套阈值，避免出现"导出很多但没生效" */
        nextTrainingMode:
          rows.length >= REAL_MODE_THRESHOLD.priority
            ? "real_priority"
            : rows.length >= REAL_MODE_THRESHOLD.hybrid
              ? "hybrid_training"
              : "synthetic_only",
        nextSteps: [
          `python server-ml/train.py --real-db ${outPath}`,
          `python server-ml/clustering.py --real-db ${outPath}`
        ],
        labelSource: "规则引擎 lifestyle_risk_label（生活方式风险，非医学诊断）"
      }
    });
  }
);

export default router;
