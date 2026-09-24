/**
 * 一键演示数据路由：POST /api/health/seed（90 天演示记录 + 演示档案，仅 admin）。
 * 拆自原 routes/health.ts（P1-2），生成规则唯一源码在 server/shared/health-seed.ts。
 */
import { Router } from "express";
import db from "../../db.js";
import { adminOnly, authMiddleware } from "../../middleware/auth.js";
import {
  buildDemoRecords,
  DEMO_PROFILE,
  DEMO_DEVICE_NAME
} from "../../../shared/health-seed.js";
import {
  planTemplateOf,
  addDays,
  fmtDate
} from "../../../shared/health-plan.js";
import {
  findProfile,
  buildRecordValues,
  RECORD_INSERT_SQL,
  enumToDb,
  SMOKING_TO_DB,
  DRINKING_TO_DB,
  EXERCISE_TO_DB
} from "./common.js";

const router = Router();

/**
 * POST /api/health/seed —— 一键生成 90 天演示数据（含演示档案）。
 *
 * 生成规则见唯一源码 `@shared/health-seed`（与 mock 同一份）：前 78 天正常 + 最近 12 天异常，
 * 让趋势图呈现「近期恶化」、报告与实时分级命中多项风险点。
 * 数据归属：只写当前登录用户；**会先清空该用户已有记录**（mock 时期同一语义：整批替换）。
 * 档案沿用 mock 口径——仅当该用户还没有档案时才写入演示档案，不动用户已填的真实档案。
 * 权限：方案接口清单标注为 **admin**。
 */
router.post("/health/seed", authMiddleware, adminOnly, (req, res) => {
  const userId = req.user!.id;
  const records = buildDemoRecords();
  const needProfile = !findProfile(userId);

  const insert = db.prepare(RECORD_INSERT_SQL);
  db.transaction(() => {
    if (needProfile) {
      db.prepare(
        `INSERT INTO profiles (
           user_id, name, gender, age, height, weight, waistline,
           medical_history, family_history, allergy_history,
           smoking, drinking, exercise, update_time
         ) VALUES (
           @user_id, @name, @gender, @age, @height, @weight, @waistline,
           @medical_history, @family_history, @allergy_history,
           @smoking, @drinking, @exercise, datetime('now','localtime')
         )`
      ).run({
        user_id: userId,
        name: DEMO_PROFILE.name,
        gender: DEMO_PROFILE.gender === 1 ? "male" : "female",
        age: DEMO_PROFILE.age,
        height: DEMO_PROFILE.height,
        weight: DEMO_PROFILE.weight,
        waistline: DEMO_PROFILE.waistline,
        medical_history: DEMO_PROFILE.medicalHistory,
        family_history: DEMO_PROFILE.familyHistory,
        allergy_history: DEMO_PROFILE.allergyHistory,
        smoking: enumToDb(SMOKING_TO_DB, DEMO_PROFILE.smoking, 0),
        drinking: enumToDb(DRINKING_TO_DB, DEMO_PROFILE.drinking, 0),
        exercise: enumToDb(EXERCISE_TO_DB, DEMO_PROFILE.exercise, 0)
      });
    }

    db.prepare("DELETE FROM records WHERE user_id = ?").run(userId);
    // C2：演示数据同时覆盖三种来源，历史页的来源标签与筛选开箱即可演示
    // （最近 3 天 = 设备同步，每第 7 天 = 批量导入，其余 = 手动录入）。
    // 只改元数据、不改任何数值，故演示的趋势 / 评分口径与改动前完全一致。
    records.forEach((r, idx) => {
      const isNewest3 = idx >= records.length - 3;
      const source = isNewest3 ? "device" : idx % 7 === 0 ? "import" : "manual";
      const { values, error } = buildRecordValues(
        r as unknown as Record<string, unknown>,
        userId,
        r.date!,
        {
          sourceType: source,
          deviceName: source === "device" ? DEMO_DEVICE_NAME : "",
          measuredAt: `${r.date} ${source === "device" ? "07:30:00" : "08:00:00"}`
        }
      );
      if (error) throw new Error(error); // 生成数据不合法属于代码缺陷，直接回滚整批
      insert.run(values);
    });

    // C1：为演示闭环生成一份「血压改善计划」并回填最近 5 天打卡
    // （今天已打 3/4 项、留 1 项未完成 → 首页「今日待完成」与「连续打卡 5 天」立即可演示）。
    const existingPlan = db
      .prepare(
        `SELECT id FROM health_plans WHERE user_id = ? AND status = 'active' LIMIT 1`
      )
      .get(userId);
    if (!existingPlan) {
      const tpl = planTemplateOf("bloodPressure");
      if (tpl) {
        const today = fmtDate(new Date());
        const start = addDays(today, -6);
        const end = addDays(today, 14);
        const planInfo = db
          .prepare(
            `INSERT INTO health_plans (user_id, title, risk_key, start_date, end_date, status, source, create_time)
             VALUES (?, ?, ?, ?, ?, 'active', 'rule', datetime('now','localtime'))`
          )
          .run(userId, tpl.title, tpl.riskKey, start, end);
        const planId = Number(planInfo.lastInsertRowid);
        const insertTask = db.prepare(
          `INSERT INTO plan_tasks (plan_id, title, task_type, frequency, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        );
        const taskIds = tpl.tasks.map((t, i) => {
          const info = insertTask.run(
            planId,
            t.title,
            t.taskType,
            t.frequency,
            i
          );
          return Number(info.lastInsertRowid);
        });
        const insertCheckin = db.prepare(
          `INSERT OR IGNORE INTO task_checkins (user_id, task_id, value, note, checked_date, create_time)
           VALUES (?, ?, '完成', '演示数据', ?, datetime('now','localtime'))`
        );
        for (let i = 4; i >= 1; i--) {
          const day = addDays(today, -i);
          for (const taskId of taskIds) insertCheckin.run(userId, taskId, day);
        }
        // 今天：只打前 3 项，留 1 项待完成
        for (const taskId of taskIds.slice(0, 3))
          insertCheckin.run(userId, taskId, today);
      }
    }
  })();

  res.json({
    code: 0,
    message: "操作成功",
    data: { total: records.length, profileCreated: needProfile }
  });
});

export default router;
