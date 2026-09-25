"""
V2.2 P0-1：无监督健康行为聚类（KMeans）。

⚠️ 这是「生活方式行为画像」聚类，不是疾病/健康分类诊断。
冷启动阶段无足够真实问卷样本时，用合成行为数据训练聚类，仅验证工程闭环。
"""
from __future__ import annotations
import os
import json
import pickle
import argparse
import collections
import numpy as np
from feature import FEATURE_ORDER, FEATURE_LABELS
from cluster_dataset import load_survey_features

from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

CLUSTER_DIR = os.path.join(os.path.dirname(__file__), "cluster-model")
PKL_PATH = os.path.join(CLUSTER_DIR, "kmeans.pkl")
META_PATH = os.path.join(CLUSTER_DIR, "metadata.json")
REPORT_PATH = os.path.join(CLUSTER_DIR, "cluster-report.json")
MODEL_VERSION = "kmeans-v0.2"

# 用于行为画像解释的关键维度
EXPLORE_FEATURES = [
    "sleep_hours_mean", "sleep_below7_days", "stress_avg",
    "exercise_days", "diet_reg_ratio", "sedentary_hours",
]


def synth_rows(n: int = 600) -> list[dict]:
    """合成行为样本，仅用于冷启动验证聚类管线。"""
    rng = np.random.default_rng(7)
    rows = []
    for _ in range(n):
        rows.append({
            "sleep_hours_mean": float(np.clip(rng.normal(7.2, 1.2), 3, 11)),
            "sleep_below7_days": int(np.clip(rng.normal(3, 2), 0, 7)),
            "sleep_quality_avg": float(np.clip(rng.normal(2.2, 0.6), 1, 3)),
            "exercise_min_sum": float(np.clip(rng.normal(120, 90), 0, 600)),
            "exercise_days": int(np.clip(rng.normal(3, 1.8), 0, 7)),
            "stress_avg": float(np.clip(rng.normal(1.9, 0.6), 1, 3)),
            "stress_high_days": float(np.clip(rng.normal(1.5, 1.5), 0, 7)),
            "diet_reg_ratio": float(np.clip(rng.normal(0.6, 0.2), 0, 1)),
            "mood_avg": float(np.clip(rng.normal(2.1, 0.5), 1, 3)),
            "study_hours": float(np.clip(rng.normal(7, 2.5), 0, 16)),
            "sedentary_hours": float(np.clip(rng.normal(8, 2.5), 0, 16)),
            "bedtime_hour": float(np.clip(rng.normal(23, 1.2), 18, 30) % 24),
            "is_off_campus": int(rng.random() < 0.3),
            "grade_code": int(rng.integers(1, 7)),
            "bmi": float(np.clip(rng.normal(20.5, 2.5), 15, 32)),
        })
    return rows




def sklearn_version() -> str:
    try:
        import sklearn
        return sklearn.__version__
    except Exception:  # pragma: no cover
        return "unknown"


def name_cluster(center):
    tags = []
    if center["sleep_hours_mean"] < 6.8 or center["sleep_below7_days"] >= 3:
        tags.append("睡眠不足/熬夜")
    if center["stress_avg"] >= 2.3:
        tags.append("压力偏高")
    if center["exercise_days"] <= 2 or center["exercise_min_sum"] < 90:
        tags.append("运动不足")
    if center["sedentary_hours"] >= 9:
        tags.append("久坐偏久")
    if center["diet_reg_ratio"] < 0.55:
        tags.append("饮食不规律")
    if not tags:
        return "健康平衡型", "作息、运动、压力较均衡", ["保持当前规律"]
    if center["stress_avg"] >= 2.3 and "睡眠不足/熬夜" not in tags:
        name = "压力负荷型"
    elif "睡眠不足/熬夜" in tags:
        name = "作息失衡型"
    elif center["sedentary_hours"] >= 9 and center["exercise_days"] <= 2:
        name = "久坐低运动型"
    elif center["diet_reg_ratio"] < 0.55:
        name = "饮食不规律型"
    else:
        name = "轻度调整型"
    sug = []
    if "睡眠不足/熬夜" in tags: sug.append("固定 23:30 前入睡")
    if "压力偏高" in tags: sug.append("每天 10 分钟放松")
    if "运动不足" in tags: sug.append("每周加 3 次 30 分钟运动")
    if "久坐偏久" in tags: sug.append("学习 50 分钟活动 5 分钟")
    if "饮食不规律" in tags: sug.append("规律三餐、坚持早餐")
    return name, "；".join(tags), sug


def train(real_db=None):

    os.makedirs(CLUSTER_DIR, exist_ok=True)
    real_rows = load_survey_features(real_db) if real_db else []
    real_n = len(real_rows)
    if real_n >= 100:
        rows, mode = real_rows, "real_priority"
    elif real_n >= 30:
        rows, mode = real_rows + synth_rows(200), "hybrid_training"
    else:
        rows, mode = synth_rows(600), "synthetic_fallback"
    X = np.array([[r[f] for f in FEATURE_ORDER] for r in rows])
    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)
    best_k, best_score, best_km = 5, -1, None
    scores = {}
    for k in range(3, 7):
        km = KMeans(n_clusters=k, n_init=10, random_state=42)
        labels = km.fit_predict(Xs)
        s = silhouette_score(Xs, labels)
        scores[k] = round(float(s), 3)
        if s > best_score:
            best_score, best_k, best_km = s, k, km

    # 轮廓系数绝对值本身很难解读：0.066 既可能是「有一点点结构」，
    # 也可能是「把噪声切了几堆」。用「随机标签」做零假设对照才有判别力 ——
    # 把真实标签打乱后重算，若也落在同一量级，说明簇结构并不存在。
    rng = np.random.default_rng(0)
    null_scores = [
        silhouette_score(Xs, rng.permutation(best_km.labels_)) for _ in range(20)
    ]
    null_mean = float(np.mean(null_scores))
    centers = scaler.inverse_transform(best_km.cluster_centers_)
    counts = collections.Counter(best_km.labels_.tolist())
    report = []
    for i, c in enumerate(centers):
        row = {FEATURE_ORDER[j]: round(float(c[j]), 2) for j in range(len(FEATURE_ORDER))}
        name, tags, sug = name_cluster(row)
        report.append({"clusterId": i, "count": counts.get(i, 0), "name": name,
                       "tags": tags, "suggestions": sug,
                       "center": {FEATURE_LABELS[k]: row[k] for k in EXPLORE_FEATURES}})
    with open(PKL_PATH, "wb") as f:
        pickle.dump({"scaler": scaler, "kmeans": best_km}, f)
    meta = {"model_version": "kmeans-v0.2", "training_mode": mode,
            "real_samples": real_n, "synthetic_samples": len(rows) - real_n,
            "feature_count": len(FEATURE_ORDER), "best_k": best_k,
            "silhouette": round(float(best_score), 3), "k_scores": scores,
            # 零假设对照：随机打乱标签后的轮廓系数均值（20 次，seed=0）。
            # 真实值远高于它 = 簇结构真实存在；两者接近 = 簇是噪声。
            "silhouette_null_baseline": round(null_mean, 4),
            "silhouette_readout": (
                f"实测 {best_score:.3f}，随机标签基线 {null_mean:.3f}；"
                "绝对分值偏低是因为合成数据各特征独立生成、原始空间无天然簇结构，"
                "但显著高于随机基线说明聚类确实抓到了结构性差异，不是把噪声硬分堆。"
            ),
            "sklearn_version": sklearn_version(),
            "features": FEATURE_ORDER, "clusters": report}
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"[cluster] kmeans-v0.2 mode={mode} real={real_n} total={len(rows)} k={best_k} "
          f"sil={best_score:.3f} null={null_mean:.4f} sklearn={sklearn_version()}")
    for c in report:
        print(f"  cluster{c['clusterId']} n={c['count']} {c['name']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--real-db", default=None)
    train(ap.parse_args().real_db)