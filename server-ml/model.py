"""模型加载与预测。

版本与训练元数据一律从 model/metadata.json 读取，避免在线服务与训练脚本
各写一份常量导致版本漂移（实测过：在线报 v0.2 而实际模型是 v0.3）。
"""
from __future__ import annotations
import os
import json
import lightgbm as lgb
from feature import build_features, data_quality

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")
MODEL_PATH = os.path.join(MODEL_DIR, "lgbm.txt")
META_PATH = os.path.join(MODEL_DIR, "metadata.json")

# 读不到元数据时的兜底版本（不应发生，metadata.json 由 train.py 生成）
FALLBACK_VERSION = "lgbm-unknown"

_clf = None
_meta = None


def _load_meta() -> dict:
    global _meta
    if _meta is None:
        try:
            with open(META_PATH, encoding="utf-8") as f:
                _meta = json.load(f)
        except Exception:
            _meta = {}
    return _meta


def model_version() -> str:
    """在线服务对外声明的型号版本，与 train.py 写入的 metadata 保持一致。"""
    return str(_load_meta().get("model_version") or FALLBACK_VERSION)


# 兼容既有 import：from model import MODEL_VERSION
MODEL_VERSION = model_version()


def _load():
    global _clf
    if _clf is None:
        _clf = lgb.Booster(model_file=MODEL_PATH)
    return _clf


def predict(raw: dict):
    """
    返回:
      riskLevel:        low|medium|high，数据不足时为 unknown
      riskProbability:  该用户被判定类别的概率
      dataQuality:      数据充分度（level / filledRatio）
      sufficient:       数据是否足以支撑预测

    数据不足（关键字段全缺）时不做预测：
    空输入在训练分布里属于分布外点，模型会给出无意义的 high 风险
    （实测全 0 输入 → high / 0.904）。这类"没数据反而最危险"的结论
    对用户是误导，必须拦掉。
    """
    quality = data_quality(raw)

    if quality["level"] == "empty":
        return {
            "riskLevel": "unknown",
            "riskProbability": 0,
            "proba": {"low": 0, "medium": 0, "high": 0},
            "dataQuality": quality,
            "sufficient": False,
            "modelVersion": model_version(),
            "message": "数据不足，请补充睡眠、运动、压力、饮食等健康记录后再预测。",
        }

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
        "dataQuality": quality,
        "sufficient": True,
        "modelVersion": model_version(),
    }
