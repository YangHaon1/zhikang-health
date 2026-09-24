/**
 * 健康档案路由：GET/PUT /api/health/profile（无档案返回 data: null，不 404）。
 * 拆自原 routes/health.ts（P1-2），共享逻辑见 ./common.ts。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  findProfile,
  toProfile,
  toNumber,
  toText,
  genderToDb,
  enumToDb,
  SMOKING_TO_DB,
  DRINKING_TO_DB,
  EXERCISE_TO_DB
} from "./common.js";

const router = Router();

/** GET /api/health/profile —— 无档案返回 data: null（不 404，前端据此判断是否已完善） */
router.get("/health/profile", authMiddleware, (req, res) => {
  const row = findProfile(req.user!.id);
  res.json({
    code: 0,
    message: "操作成功",
    data: row ? toProfile(row) : null
  });
});

/** PUT /api/health/profile —— 局部更新（upsert），只覆盖传入的字段 */
router.put("/health/profile", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const prev = findProfile(userId);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  // 未传入的字段沿用原值，没有原值时用列表默认值
  const merged = {
    user_id: userId,
    name: has("name")
      ? toText(body.name, prev?.name ?? "")
      : (prev?.name ?? ""),
    gender: has("gender") ? genderToDb(body.gender) : (prev?.gender ?? "male"),
    age: has("age") ? toNumber(body.age, prev?.age ?? 0) : (prev?.age ?? 0),
    height: has("height")
      ? toNumber(body.height, prev?.height ?? 0)
      : (prev?.height ?? 0),
    weight: has("weight")
      ? toNumber(body.weight, prev?.weight ?? 0)
      : (prev?.weight ?? 0),
    waistline: has("waistline")
      ? toNumber(body.waistline, prev?.waistline ?? 0)
      : (prev?.waistline ?? 0),
    medical_history: has("medicalHistory")
      ? toText(body.medicalHistory, prev?.medical_history ?? "")
      : (prev?.medical_history ?? ""),
    family_history: has("familyHistory")
      ? toText(body.familyHistory, prev?.family_history ?? "")
      : (prev?.family_history ?? ""),
    allergy_history: has("allergyHistory")
      ? toText(body.allergyHistory, prev?.allergy_history ?? "")
      : (prev?.allergy_history ?? ""),
    smoking: has("smoking")
      ? enumToDb(SMOKING_TO_DB, body.smoking, prev?.smoking ?? 0)
      : (prev?.smoking ?? 0),
    drinking: has("drinking")
      ? enumToDb(DRINKING_TO_DB, body.drinking, prev?.drinking ?? 0)
      : (prev?.drinking ?? 0),
    exercise: has("exercise")
      ? enumToDb(EXERCISE_TO_DB, body.exercise, prev?.exercise ?? 0)
      : (prev?.exercise ?? 0),
    sleep_habit: has("sleepHabit")
      ? toText(body.sleepHabit, prev?.sleep_habit ?? "")
      : (prev?.sleep_habit ?? ""),
    exercise_habit: has("exerciseHabit")
      ? toText(body.exerciseHabit, prev?.exercise_habit ?? "")
      : (prev?.exercise_habit ?? ""),
    diet_habit: has("dietHabit")
      ? toText(body.dietHabit, prev?.diet_habit ?? "")
      : (prev?.diet_habit ?? ""),
    health_goal: has("healthGoal")
      ? toText(body.healthGoal, prev?.health_goal ?? "")
      : (prev?.health_goal ?? ""),
    sleep_hours: has("sleepHours")
      ? Number(body.sleepHours) || 0
      : (prev?.sleep_hours ?? 0),
    exercise_frequency: has("exerciseFrequency")
      ? Number(body.exerciseFrequency) || 0
      : (prev?.exercise_frequency ?? 0),
    goal_description: has("goalDescription")
      ? toText(body.goalDescription, prev?.goal_description ?? "")
      : (prev?.goal_description ?? "")
  };

  db.prepare(
    `INSERT INTO profiles (
       user_id, name, gender, age, height, weight, waistline,
       medical_history, family_history, allergy_history,
       smoking, drinking, exercise,
       sleep_habit, exercise_habit, diet_habit, health_goal, sleep_hours, exercise_frequency, goal_description, update_time
     ) VALUES (
       @user_id, @name, @gender, @age, @height, @weight, @waistline,
       @medical_history, @family_history, @allergy_history,
       @smoking, @drinking, @exercise,
       @sleep_habit, @exercise_habit, @diet_habit, @health_goal, @sleep_hours, @exercise_frequency, @goal_description, datetime('now','localtime')
     )
     ON CONFLICT(user_id) DO UPDATE SET
       name = excluded.name,
       gender = excluded.gender,
       age = excluded.age,
       height = excluded.height,
       weight = excluded.weight,
       waistline = excluded.waistline,
       medical_history = excluded.medical_history,
       family_history = excluded.family_history,
       allergy_history = excluded.allergy_history,
       smoking = excluded.smoking,
       drinking = excluded.drinking,
       exercise = excluded.exercise,
       sleep_habit = excluded.sleep_habit,
       exercise_habit = excluded.exercise_habit,
       diet_habit = excluded.diet_habit,
       health_goal = excluded.health_goal,
       sleep_hours = excluded.sleep_hours,
       exercise_frequency = excluded.exercise_frequency,
       goal_description = excluded.goal_description,
       update_time = excluded.update_time`
  ).run(merged);

  res.json({
    code: 0,
    message: "操作成功",
    data: toProfile(findProfile(userId)!)
  });
});

export default router;
