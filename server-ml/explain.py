"""SHAP 解释：输出 Top3 风险因素。SHAP 不可用时回退到模型特征重要性。"""
from __future__ import annotations
import numpy as np
import lightgbm as lgb
from feature import build_features, FEATURE_ORDER, FEATURE_LABELS
from model import _load

_explainer = None
_fallback_importance = None


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


def explain(raw: dict, k: int = 3):
    x = np.array([build_features(raw)])
    factors = []
    try:
        exp = _get_explainer()
        sv = exp.shap_values(x)[0]
        # 三分类时 sv 可能是 (features, classes)，取被预测类
        contrib = (sv.mean(axis=1) if sv.ndim == 2 else sv)
        order = np.argsort(-np.abs(contrib))
        for i in order[:k]:
            factors.append({
                "feature": FEATURE_ORDER[i],
                "label": FEATURE_LABELS[FEATURE_ORDER[i]],
                "contribution": round(float(contrib[i]), 4),
                "direction": "raise_risk" if contrib[i] > 0 else "lower_risk",
            })
    except Exception:
        # 回退：按全局 gain 重要性
        imp = _get_importance()
        order = np.argsort(-imp)
        for i in order[:k]:
            factors.append({
                "feature": FEATURE_ORDER[i],
                "label": FEATURE_LABELS[FEATURE_ORDER[i]],
                "contribution": round(float(imp[i]), 2),
                "direction": "raise_risk",
            })
    return factors
