"""
V2.2 P0-2：在线健康行为聚类预测。
加载 cluster-model/kmeans.pkl，输入行为特征 → 输出所属行为画像簇。
"""
from __future__ import annotations
import os
import pickle
import json
import numpy as np
from feature import FEATURE_ORDER

PKL_PATH = os.path.join(os.path.dirname(__file__), "cluster-model", "kmeans.pkl")
META_PATH = os.path.join(os.path.dirname(__file__), "cluster-model", "metadata.json")

# 簇 → 行为画像名（冷启动 k=3 时按簇心特征命名；真实数据重训后再校准）
CLUSTER_NAMES = {
    0: {"name": "规律平衡型", "desc": "作息与运动较均衡，生活节奏稳定"},
    1: {"name": "轻度久坐型", "desc": "久坐中等，整体状态尚可，建议增加活动"},
    2: {"name": "久坐高压型", "desc": "久坐时间长、熬夜偏多，需重点调整作息"},
}


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
    vec = [[float(raw.get(k, 0) or 0) for k in FEATURE_ORDER]]
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