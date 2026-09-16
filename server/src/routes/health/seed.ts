/**
 * 一键演示数据路由：POST /api/health/seed（90 天演示记录 + 演示档案，仅 admin）。
 * 拆自原 routes/health.ts（P1-2），生成规则唯一源码在 server/shared/health-seed.ts。
 */
import { Router } from "express";
import db from "../../db.js";
import { adminOnly, authMiddleware } from "../../middleware/auth.js";
import { buildDemoRecords, DEMO_PROFILE } from "../../../shared/health-seed.js";
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
    for (const r of records) {
      const { values, error } = buildRecordValues(
        r as unknown as Record<string, unknown>,
        userId,
        r.date!
      );
      if (error) throw new Error(error); // 生成数据不合法属于代码缺陷，直接回滚整批
      insert.run(values);
    }
  })();

  res.json({
    code: 0,
    message: "操作成功",
    data: { total: records.length, profileCreated: needProfile }
  });
});

export default router;
