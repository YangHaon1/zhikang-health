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


# 训练集统计值（与 dataset._default_row 一致，取自合成数据的生成均值/中位数）。
#
# 为什么不能用 0 填充：
#   0 在训练分布里是极端值而非「平均水平」——就寝 0 点、BMI 0、睡眠 0 小时
#   都会被模型理解成「极端不健康」，导致新用户（什么都没填）被判成高风险。
#   实测：全 0 输入 → riskLevel=high, proba=0.904。这是必须修的方向性错误。
FEATURE_DEFAULTS = {
    "sleep_hours_mean": 7.2,
    "sleep_below7_days": 3,
    "sleep_quality_avg": 2.2,
    "exercise_min_sum": 120.0,
    "exercise_days": 3,
    "stress_avg": 1.9,
    "stress_high_days": 1.5,
    "diet_reg_ratio": 0.6,
    "mood_avg": 2.1,
    "study_hours": 7.0,
    "sedentary_hours": 8.0,
    "bedtime_hour": 23.0,
    "is_off_campus": 0,
    "grade_code": 3,
    "bmi": 20.5,
}

# 关键字段：缺得越多，预测越不可信
KEY_FIELDS = [
    "sleep_hours_mean",
    "exercise_min_sum",
    "stress_avg",
    "diet_reg_ratio",
]


# 合法取值可以是 0 的字段：「0 天」「0 次」「不在校外」都是真实语义，
# 这些地方的 0 必须原样喂给模型，不能当成没填。
ZERO_VALID = {"exercise_days", "sleep_below7_days", "is_off_campus"}

# 其余字段的 0 只可能是「没填」或离谱值：睡眠 0 小时、BMI 0、压力 0 分、
# 睡眠质量 0 分（训练区间是 1~3）。这类 0 一旦原样进模型，
# 会被理解成极端不健康，正是 FEATURE_DEFAULTS 存在要避免的方向性错误。
ZERO_IS_MISSING = [k for k in FEATURE_ORDER if k not in ZERO_VALID]


def build_features(raw: dict) -> list[float]:
    """
    输入原始 dict（字段名与 FEATURE_ORDER 一致）。
    缺失 / 空值 / 「只可能是没填的 0」一律用训练集统计值填充，绝不填 0。

    ⚠️ 之前只判 `v is None or v == ""`，数据库把「未填写」存成 0 时会原样透传，
    于是 features 里出现 0，data_quality 又按「!=0」计成缺失 —— 两个口径打架，
    演示账号的风险判定被一批分布外的 0 推着走。这里把两种口径统一到「模型实际吃的值」。
    """
    out: list[float] = []
    for k in FEATURE_ORDER:
        v = raw.get(k)
        if v is None or v == "":
            v = FEATURE_DEFAULTS[k]
        elif k in ZERO_IS_MISSING and isinstance(v, (int, float)) and float(v) == 0:
            v = FEATURE_DEFAULTS[k]
        out.append(float(v))
    return out


def is_missing(raw: dict, key: str) -> bool:
    """某个特征是否「没填」—— 与 build_features 的填充判定完全同口径。"""
    v = raw.get(key)
    if v is None or v == "":
        return True
    return key in ZERO_IS_MISSING and isinstance(v, (int, float)) and float(v) == 0


def data_quality(raw: dict) -> dict:
    """
    数据充分度：关键字段缺失越多，质量越低。

    level:
      high    ≥75% 关键字段有值
      medium  ≥50%
      low     <50%
      empty   一个关键字段都没有 → 调用方应拒绝预测，而不是给出"高风险"
    """
    present = sum(
        1
        for f in KEY_FIELDS
        if raw.get(f) is not None and raw.get(f) != "" and raw.get(f) != 0
    )
    ratio = present / len(KEY_FIELDS)
    if present == 0:
        level = "empty"
    elif ratio >= 0.75:
        level = "high"
    elif ratio >= 0.5:
        level = "medium"
    else:
        level = "low"
    return {"level": level, "filledRatio": round(ratio, 2)}
