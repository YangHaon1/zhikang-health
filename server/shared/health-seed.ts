// 一键演示数据生成器（唯一源码）
// ★ 后端（server/src/routes/health.ts 的 /api/health/seed）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
//
// 数据形态刻意设计成「前 78 天正常 + 最近 12 天异常」：
// 趋势图能呈现「近期恶化」，报告与实时分级能稳定命中多项风险点，便于演示 AI 分析价值。
import type { HealthProfile, HealthRecord } from "./health-engine.js";

/** 演示档案：45 岁男性、身高 172cm、体重 78kg（BMI≈26.4 超重）、偶尔吸烟饮酒、几乎不运动 */
export const DEMO_PROFILE: Omit<HealthProfile, "createTime"> = {
  name: "演示用户",
  gender: 1,
  age: 45,
  height: 172,
  weight: 78,
  waistline: 88,
  medicalHistory: "无",
  familyHistory: "父亲有高血压史",
  allergyHistory: "无",
  smoking: "偶尔",
  drinking: "偶尔",
  exercise: "几乎不运动"
};

/**
 * C2 演示设备名：一键演示数据里「设备同步」来源的记录统一用它，
 * 前端手动同步演示（设备同步面板）也用同一个名字，保证筛选 / 标签文案一致。
 */
export const DEMO_DEVICE_NAME = "智康智能血压计 BP-200";

/** 生成 90 天演示记录（按日期升序，最后一条为今天） */
export function buildDemoRecords(today = new Date()): Array<HealthRecord> {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const records: Array<HealthRecord> = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    // 最近 12 天为「异常演示段」，其余为「正常段」
    const abnormal = i < 12;
    records.push({
      id: `${Date.now()}-${i}`,
      date: fmt(d),
      // 血压：正常段 116~132/73~84，异常段 150~165/90~100（一/二级高血压）
      systolic: abnormal
        ? 150 + Math.round(Math.random() * 15)
        : 116 + Math.round(Math.random() * 16),
      diastolic: abnormal
        ? 90 + Math.round(Math.random() * 10)
        : 73 + Math.round(Math.random() * 11),
      // 空腹血糖：异常段 7.0~7.6（疑似糖尿病）
      fastingGlucose: Number(
        (abnormal
          ? 7.0 + Math.random() * 0.6
          : 4.6 + Math.random() * 1.3
        ).toFixed(1)
      ),
      postprandialGlucose: Number(
        (abnormal
          ? 8.2 + Math.random() * 1.6
          : 6.3 + Math.random() * 1.6
        ).toFixed(1)
      ),
      totalCholesterol: Number(
        (abnormal
          ? 5.4 + Math.random() * 1.0
          : 4.1 + Math.random() * 1.2
        ).toFixed(1)
      ),
      triglyceride: Number(
        (abnormal
          ? 1.8 + Math.random() * 0.8
          : 1.0 + Math.random() * 0.7
        ).toFixed(1)
      ),
      // LDL：异常段 4.1~4.5（升高）
      ldl: Number(
        (abnormal
          ? 4.1 + Math.random() * 0.4
          : 2.3 + Math.random() * 1.0
        ).toFixed(1)
      ),
      hdl: Number((1.0 + Math.random() * 0.4).toFixed(1)),
      heartRate: 68 + Math.round(Math.random() * 16),
      bloodOxygen: 96 + Math.round(Math.random() * 3),
      // 体重：正常段 74 缓升至 78，异常段维持 78
      weight: Number((abnormal ? 78 : 74 + (89 - i) * 0.045).toFixed(1)),
      remark: abnormal && i < 3 ? "近期加班多、睡眠不足" : ""
    });
  }
  return records;
}
