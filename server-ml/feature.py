"""
特征处理模块。
把「大学生原始健康数据」转成统一的 LightGBM 特征向量。

⚠️ 冷启动演示说明：
  本服务用于产品闭环演示，特征与标签均来自生活方式数据，
  不构成任何医学诊断，不能替代专业医疗评估。
"""
from __future__ import annotations
import json
import os

# ---------------------------------------------------------------------------
# 特征定义的唯一来源：server-ml/feature-spec.json
#
# 之前 FEATURE_ORDER / FEATURE_LABELS / FEATURE_DEFAULTS 在本文件硬编码，
# 而 dataset.py 又抄了一份「同口径」默认值（grade_code 实际是 1，与本文件 3 不一致），
# Node 侧 risk.ts 也手写过同一批特征名。三处独立维护必然漂移，
# 现在统一从 spec 读，Node 侧读同一份文件（server/shared/feature-spec.ts）。
# ---------------------------------------------------------------------------
SPEC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feature-spec.json")

with open(SPEC_PATH, encoding="utf-8") as _f:
    FEATURE_SPEC: dict = json.load(_f)

# 特征顺序固定，train / predict 共用，绝不能乱序
FEATURE_ORDER: list[str] = list(FEATURE_SPEC["feature_order"])
FEATURE_LABELS: dict[str, str] = dict(FEATURE_SPEC["feature_labels"])
FEATURE_UNITS: dict[str, str] = dict(FEATURE_SPEC["feature_units"])

# 训练集统计值（缺失填充用，出处见 spec 的 defaults_provenance）。
#
# 为什么不能用 0 填充：
#   0 在训练分布里是极端值而非「平均水平」——就寝 0 点、BMI 0、睡眠 0 小时
#   都会被模型理解成「极端不健康」，导致新用户（什么都没填）被判成高风险。
#   实测：全 0 输入 → riskLevel=high, proba=0.904。这是必须修的方向性错误。
#
# ⚠️ 出处更正（2026-09-25）：旧注释写「与 dataset._default_row 一致，取自中位数」，
#   实测该数据集（train.make_synth, seed=42, n=4000）真实中位数为
#   sleep_below7_days=2 / exercise_days=2 / stress_high_days=1，
#   而默认值是 3 / 3 / 1.5 —— 出处说法不成立。实际是生成均值（四舍五入一位小数）。
#   数值本身仍在训练分布内（不是极端值），故不修改填充口径，只更正注释与出处。
FEATURE_DEFAULTS: dict[str, float] = {
    k: float(v) for k, v in FEATURE_SPEC["feature_defaults"].items()
}

# 关键字段：缺得越多，预测越不可信
KEY_FIELDS: list[str] = list(FEATURE_SPEC["key_fields"])


# 合法取值可以是 0 的字段：「0 天」「0 次」「不在校外」都是真实语义，
# 这些地方的 0 必须原样喂给模型，不能当成没填。
ZERO_VALID: frozenset[str] = frozenset(FEATURE_SPEC["zero_valid"])

# spec 与代码的一致性自检：任何一侧漏字段都在 import 时立刻炸掉，
# 而不是等到线上把 KeyError 吞进 catch 里变成静默降级。
_missing_defaults = [k for k in FEATURE_ORDER if k not in FEATURE_DEFAULTS]
_missing_labels = [k for k in FEATURE_ORDER if k not in FEATURE_LABELS]
if _missing_defaults or _missing_labels:
    raise ValueError(
        f"feature-spec.json 不完整: defaults 缺 {_missing_defaults}, labels 缺 {_missing_labels}"
    )
if not ZERO_VALID <= set(FEATURE_ORDER):
    raise ValueError(f"feature-spec.json 的 zero_valid 含未知字段: {ZERO_VALID - set(FEATURE_ORDER)}")

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
    """
    某个特征是否「没填」。

    这是全局唯一的缺失判定口径：`build_features()` 与 `data_quality()` 都走它，
    因此前端显示的「已填比例」永远等于模型实际吃到的实测值比例。

    注意历史坑：旧实现把 `0` 一律当缺失（`!= 0`），而 build_features 只判
    `None / ""`，同一个 0 被一边计成"已填"、一边被填成统计值 —— 两个口径打架。
    现在两边只认这一个函数；真正的 0（如「运动 0 分钟」）请由调用方传 `None`
    或用 ZERO_VALID 里的字段表达，不要指望这里猜。
    """
    v = raw.get(key)
    if v is None or v == "":
        return True
    return key in ZERO_IS_MISSING and isinstance(v, (int, float)) and float(v) == 0


def data_quality(raw: dict) -> dict:
    """
    数据充分度：关键字段缺失越多，质量越低。

    ⚠️ 判定一律走 `is_missing()`，绝不另写一套「!= 0 就算缺失」的口径。
    旧实现这里按 `raw.get(f) != 0` 计缺失、`build_features` 却可能把同一个 0
    当成实测值喂给模型 —— 两个口径打架，前端会看到「已填 4/4」而模型吃的是填充值。

    level:
      high    ≥75% 关键字段有值
      medium  ≥50%
      low     <50%
      empty   一个关键字段都没有 → 调用方应拒绝预测，而不是给出"高风险"
    """
    present = sum(1 for f in KEY_FIELDS if not is_missing(raw, f))
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
