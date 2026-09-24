"""
特征处理模块。
把「大学生原始健康数据」转成统一的 LightGBM 特征向量。

⚠️ 冷启动演示说明：
  本服务用于产品闭环演示，特征与标签均来自生活方式数据，
  不构成任何医学诊断，不能替代专业医疗评估。
"""
from __future__ import annotations

# 特征顺序固定，train / predict 共用，绝不能乱序
FEATURE_ORDER = [
    "sleep_hours_mean",      # 平均睡眠时长(h)
    "sleep_below7_days",     # 一周内睡眠<7h天数
    "sleep_quality_avg",     # 平均睡眠质量 1差/2一般/3好
    "exercise_min_sum",      # 周运动总分钟
    "exercise_days",          # 周运动天数
    "stress_avg",            # 平均压力 1小/2中/3大
    "stress_high_days",      # 压力=3 的天数
    "diet_reg_ratio",        # 饮食规律占比 0~1
    "mood_avg",              # 平均心情 1差/2一般/3好
    "study_hours",           # 日均学习时长(h)
    "sedentary_hours",       # 日均久坐时长(h)
    "bedtime_hour",          # 就寝时刻换算(小时，如 23.5)
    "is_off_campus",         # 0/1
    "grade_code",            # 年级序数 大一=1..研三=6
    "bmi",                   # 身体质量指数
]

FEATURE_LABELS = {
    "sleep_hours_mean": "睡眠时长",
    "sleep_below7_days": "睡眠不足天数",
    "sleep_quality_avg": "睡眠质量",
    "exercise_min_sum": "运动时长",
    "exercise_days": "运动频率",
    "stress_avg": "平均压力",
    "stress_high_days": "高压天数",
    "diet_reg_ratio": "饮食规律",
    "mood_avg": "情绪状态",
    "study_hours": "学习时长",
    "sedentary_hours": "久坐时长",
    "bedtime_hour": "就寝时间",
    "is_off_campus": "校外住宿",
    "grade_code": "年级",
    "bmi": "BMI",
}


def build_features(raw: dict) -> list[float]:
    """
    输入原始 dict（字段名与 FEATURE_ORDER 一致，缺失给安全默认值），
    输出按 FEATURE_ORDER 排列的特征向量。
    """
    out: list[float] = []
    for k in FEATURE_ORDER:
        v = raw.get(k)
        if v is None:
            v = 0
        out.append(float(v))
    return out


def data_quality(raw: dict) -> dict:
    """简单数据充分度：关键字段缺失越多，质量越低。"""
    key_fields = [
        "sleep_hours_mean", "exercise_min_sum",
        "stress_avg", "diet_reg_ratio"
    ]
    present = sum(1 for f in key_fields if raw.get(f) not in (None, 0))
    ratio = present / len(key_fields)
    level = "high" if ratio >= 0.75 else "medium" if ratio >= 0.5 else "low"
    return {"level": level, "filledRatio": round(ratio, 2)}
