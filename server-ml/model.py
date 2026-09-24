"""模型加载与预测。"""
from __future__ import annotations
import os
import lightgbm as lgb
from feature import build_features, data_quality

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "lgbm.txt")
MODEL_VERSION = "lgbm-v0.2"

_clf = None


def _load():
    global _clf
    if _clf is None:
        _clf = lgb.Booster(model_file=MODEL_PATH)
    return _clf


def predict(raw: dict):
    """
    返回:
      riskLevel: low|medium|high
      riskProbability: 该用户被判定类别的概率
      dataQuality: 数据充分度
    """
    booster = _load()
    x = [build_features(raw)]
    proba = booster.predict(x)[0]  # [p_low, p_medium, p_high]
    idx = int(proba.argmax())
    level = ["low", "medium", "high"][idx]
    return {
        "riskLevel": level,
        "riskProbability": round(float(proba[idx]), 3),
        "proba": {
            "low": round(float(proba[0]), 3),
            "medium": round(float(proba[1]), 3),
            "high": round(float(proba[2]), 3),
        },
        "dataQuality": data_quality(raw),
    }
