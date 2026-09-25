"""SHAP 解释：输出 Top-K 风险因素。SHAP 不可用时回退到模型特征重要性。

输出字段（与 Node 侧 ShapFactor 对齐）：
  factor      特征键名（如 stress_avg）
  label       中文名（如 平均压力）
  value       SHAP 贡献值（对【被预测类别】的贡献，带正负号）
  direction   raise_risk / lower_risk / unknown
  description 面向用户的一句话说明

⚠️ 方向正确性（重要）：
  多分类模型下 shap_values 对每个类别各有一套贡献值。若对所有类别取平均，
  正负贡献会相互抵消，出现「睡 8 小时 = 升高风险」这类反直觉结论。
  因此必须取【被预测类别】那一列，而不是全类平均。
"""
from __future__ import annotations
import numpy as np
from feature import build_features, FEATURE_ORDER, FEATURE_LABELS
from model import _load

_explainer = None
_fallback_importance = None

# 类别索引：与 train.py 的 LABELS = {"low":0,"medium":1,"high":2} 保持一致
HIGH_CLASS_INDEX = 2


def _get_explainer():
    global _explainer
    if _explainer is None:
        import shap  # 延迟导入，装不上也不阻塞启动
        booster = _load()
        _explainer = shap.TreeExplainer(booster)
    return _explainer


def _get_importance():
    global _fallback_importance
    if _fallback_importance is None:
        booster = _load()
        _fallback_importance = booster.feature_importance(importance_type="gain")
    return _fallback_importance


def _predicted_class(x: np.ndarray) -> int:
    """模型对本样本的预测类别索引（0=low, 1=medium, 2=high）。"""
    proba = _load().predict(x)[0]
    return int(np.asarray(proba).argmax())


def _as_class_matrix(sv, n_features: int):
    """
    把 shap_values 的多种返回形态统一成 (n_features, n_classes)。
    返回 None 表示无法解析为多分类矩阵（按单输出处理）。
    """
    if isinstance(sv, list):
        # 新版 shap：list[n_classes]，每项 shape = (n_samples, n_features)
        arr = np.stack([np.asarray(a).reshape(-1, n_features) for a in sv], axis=-1)
        return arr[0]  # (n_features, n_classes)
    arr = np.asarray(sv)
    if arr.ndim == 3:
        # (n_samples, n_features, n_classes)
        return arr[0]
    if arr.ndim == 2 and arr.shape[0] == n_features and arr.shape[1] > 1:
        # 已是 (n_features, n_classes)
        return arr
    return None


def _fmt_value(v) -> str:
    """特征值展示：浮点保留 1 位，整数原样输出。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "未知"
    if abs(f - round(f)) < 1e-6:
        return str(int(round(f)))
    return f"{f:.1f}"


def _describe(label: str, raw_value, direction: str) -> str:
    """面向用户的一句话说明。不做医学判断，只陈述模型归因结果。"""
    shown = _fmt_value(raw_value)
    if direction == "raise_risk":
        return f"{label}当前为 {shown}，是本次风险判定的主要推高因素"
    if direction == "lower_risk":
        return f"{label}当前为 {shown}，对本次风险判定起缓解作用"
    return f"{label}当前为 {shown}，方向待定（模型解释降级，仅显示重要度）"


def explain(raw: dict, k: int = 3):
    """
    返回 Top-K 因素。

    两个口径必须分开，混用会得到反直觉结论：
      · 重要度排序 —— 用【被预测类别】的 |SHAP|（回答"模型为什么这样判"）
      · 风险方向   —— 统一用【high 类】的 SHAP 符号（回答"这个因素让风险升高还是降低"）
    因为对 low 类的正贡献意味着"把判定推向低风险"，若直接拿它当方向，
    会出现「睡 8 小时 = 升高风险」这种错误展示。
    """
    x = np.array([build_features(raw)])
    n_features = len(FEATURE_ORDER)
    factors = []
    try:
        exp = _get_explainer()
        sv = exp.shap_values(x)
        matrix = _as_class_matrix(sv, n_features)
        if matrix is None:
            raise ValueError("无法解析 SHAP 输出形态")
        n_classes = matrix.shape[1]
        pred = _predicted_class(x)
        if pred >= n_classes:
            pred = int(np.argmax(np.abs(matrix).sum(axis=0)))

        contrib_pred = matrix[:, pred]                       # 解释本次判定
        risk_idx = min(HIGH_CLASS_INDEX, n_classes - 1)      # 风险方向统一取 high 类
        contrib_risk = matrix[:, risk_idx]

        order = np.argsort(-np.abs(contrib_pred))[:k]
        for i in order:
            key = FEATURE_ORDER[i]
            val = float(contrib_risk[i])
            direction = "raise_risk" if val > 0 else "lower_risk"
            factors.append({
                "factor": key,
                "label": FEATURE_LABELS[key],
                "value": round(val, 4),
                "contribution": round(val, 4),   # 兼容旧调用方
                "predictedClass": pred,
                "direction": direction,
                "description": _describe(FEATURE_LABELS[key], raw.get(key), direction),
            })
    except Exception:
        # 回退：只有全局 gain 重要性，没有方向信息 —— 必须如实标注 unknown，
        # 不能把「不知道」伪装成「升高风险」。
        imp = _get_importance()
        order = np.argsort(-np.asarray(imp))[:k]
        for i in order:
            key = FEATURE_ORDER[i]
            factors.append({
                "factor": key,
                "label": FEATURE_LABELS[key],
                "value": round(float(imp[i]), 2),
                "contribution": round(float(imp[i]), 2),
                "direction": "unknown",
                "description": _describe(FEATURE_LABELS[key], raw.get(key), "unknown"),
            })
    return factors
