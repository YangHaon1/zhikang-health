"""
V2.2 P0-2：在线健康行为聚类预测。
加载 cluster-model/kmeans.pkl，输入行为特征 → 输出所属行为画像簇。
"""
from __future__ import annotations
import os
import pickle
import json
import numpy as np
from feature import FEATURE_ORDER, FEATURE_DEFAULTS

PKL_PATH = os.path.join(os.path.dirname(__file__), "cluster-model", "kmeans.pkl")
META_PATH = os.path.join(os.path.dirname(__file__), "cluster-model", "metadata.json")

_model = None
_meta = None


def _load():
    global _model, _meta
    if _model is None and os.path.exists(PKL_PATH):
        with open(PKL_PATH, "rb") as f:
            _model = pickle.load(f)
    if _meta is None and os.path.exists(META_PATH):
        with open(META_PATH, encoding="utf-8") as f:
            _meta = json.load(f)
    return _model


def cluster_predict(raw: dict) -> dict:
    m = _load()
    if m is None:
        return {"available": False}
    # 与 model.predict 同口径：缺失值用训练集统计值填充，不能填 0
    # （0 = 就寝 0 点 / BMI 0 / 睡眠 0 小时，在训练分布里是极端值，会把新用户判成最差簇）
    vec = [
        [
            float(raw.get(k) if raw.get(k) not in (None, "") else FEATURE_DEFAULTS[k])
            for k in FEATURE_ORDER
        ]
    ]
    X = m["scaler"].transform(vec)
    cid = int(m["kmeans"].predict(X)[0])
    dists = m["kmeans"].transform(X)[0]
    conf = round(float(1 - dists[cid] / (dists.sum() + 1e-6)), 3)
    clusters = (_meta or {}).get("clusters", [])
    info = next((c for c in clusters if c.get("clusterId") == cid), None)
    return {
        "available": True,
        "clusterId": cid,
        "name": (info or {}).get("name", "待识别型"),
        "description": (info or {}).get("tags", ""),
        "suggestions": (info or {}).get("suggestions", []),
        "confidence": conf,
        "modelVersion": (_meta or {}).get("model_version", "kmeans-v0.2"),
    }