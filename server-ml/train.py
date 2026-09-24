"""
训练脚本。

⚠️ 冷启动验证数据说明（重要）：
  比赛/产品冷启动阶段没有真实问卷标注，这里用「可解释规则」生成演示标签，
  仅用于验证 数据->训练->预测->解释 的工程闭环。
  这不是医学诊断模型，输出不能用于任何健康/医疗决策。

正式版应替换为真实量表标签（如 PSSQ / GHQ-12）。
"""
from __future__ import annotations
import os
import json
import argparse
import numpy as np
import lightgbm as lgb
from feature import FEATURE_ORDER
from dataset import load_real_dataset, label_distribution

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")
MODEL_PATH = os.path.join(MODEL_DIR, "lgbm.txt")
META_PATH = os.path.join(MODEL_DIR, "metadata.json")
MODEL_VERSION = "lgbm-v0.3"


LABELS = {"low": 0, "medium": 1, "high": 2}


def rule_label(row: dict) -> int:
    """规则打标：生活方式型亚健康，非疾病诊断。"""
    score = 0
    # 睡眠不足扣分
    if row["sleep_hours_mean"] < 6.5:
        score += 2
    elif row["sleep_hours_mean"] < 7.5:
        score += 1
    if row["sleep_below7_days"] >= 4:
        score += 1
    if row["sleep_quality_avg"] <= 1.5:
        score += 1
    # 压力
    if row["stress_avg"] >= 2.5:
        score += 2
    elif row["stress_avg"] >= 2:
        score += 1
    if row["stress_high_days"] >= 3:
        score += 1
    # 运动不足
    if row["exercise_min_sum"] < 60:
        score += 1
    if row["exercise_days"] < 2:
        score += 1
    # 饮食
    if row["diet_reg_ratio"] < 0.5:
        score += 1
    # 久坐
    if row["sedentary_hours"] >= 10:
        score += 1
    # 熬夜
    if row["bedtime_hour"] >= 1:  # 0~6 点才睡
        score += 1

    if score >= 5:
        return LABELS["high"]
    if score >= 2:
        return LABELS["medium"]
    return LABELS["low"]


def make_synth(n: int = 4000):
    rng = np.random.default_rng(42)
    rows = []
    for _ in range(n):
        sleep = rng.normal(7.2, 1.2)
        row = {
            "sleep_hours_mean": float(np.clip(sleep, 3, 11)),
            "sleep_below7_days": int(np.clip(rng.normal(3, 2), 0, 7)),
            "sleep_quality_avg": float(np.clip(rng.normal(2.2, 0.6), 1, 3)),
            "exercise_min_sum": float(np.clip(rng.normal(120, 90), 0, 600)),
            "exercise_days": int(np.clip(rng.normal(3, 1.8), 0, 7)),
            "stress_avg": float(np.clip(rng.normal(1.9, 0.6), 1, 3)),
            "stress_high_days": int(np.clip(rng.normal(1.5, 1.5), 0, 7)),
            "diet_reg_ratio": float(np.clip(rng.normal(0.6, 0.2), 0, 1)),
            "mood_avg": float(np.clip(rng.normal(2.1, 0.5), 1, 3)),
            "study_hours": float(np.clip(rng.normal(7, 2.5), 0, 16)),
            "sedentary_hours": float(np.clip(rng.normal(8, 2.5), 0, 16)),
            "bedtime_hour": float(np.clip(rng.normal(23, 1.2), 18, 30) % 24),
            "is_off_campus": int(rng.random() < 0.3),
            "grade_code": int(rng.integers(1, 7)),
            "bmi": float(np.clip(rng.normal(20.5, 2.5), 15, 32)),
        }
        rows.append(row)
    X = np.array([[r[f] for f in FEATURE_ORDER] for r in rows])
    y = np.array([rule_label(r) for r in rows])
    return X, y


def train(real_db: str | None = None):
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import (
        accuracy_score, precision_recall_fscore_support, roc_auc_score, confusion_matrix
    )
    os.makedirs(MODEL_DIR, exist_ok=True)

    # 1) 合成数据（始终作为基础/fallback）
    Xs, ys = make_synth()
    synth_n = len(ys)

    # 2) 真实问卷数据（可选合并）
    real_X_rows, real_y = [], []
    if real_db:
        real_rows, real_y = load_real_dataset(real_db)
        real_X_rows = [[r[f] for f in FEATURE_ORDER] for r in real_rows]
    real_n = len(real_y)

    if real_n >= 100:
        mode = "real_priority"
        X = np.vstack([np.array(real_X_rows), Xs[: max(0, 800 - real_n)]])
        y = np.concatenate([np.array(real_y), ys[: max(0, 800 - real_n)]])
    elif real_n >= 20:
        mode = "hybrid_training"
        X = np.vstack([np.array(real_X_rows), Xs])
        y = np.concatenate([np.array(real_y), ys])
    else:
        mode = "synthetic_only"
        X, y = Xs, ys

    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    clf = lgb.LGBMClassifier(
        n_estimators=120,
        max_depth=4,
        learning_rate=0.1,
        num_leaves=8,
        objective="multiclass",
        num_class=3,
        min_child_samples=20,
        verbose=-1,
    )
    clf.fit(X_tr, y_tr)
    clf.booster_.save_model(MODEL_PATH)

    pred = clf.predict(X_te)
    proba = clf.predict_proba(X_te)
    acc = accuracy_score(y_te, pred)
    p, r, f1, _ = precision_recall_fscore_support(
        y_te, pred, labels=[0, 1, 2], zero_division=0
    )
    try:
        auc = roc_auc_score(y_te, proba, multi_class="ovr", average="macro")
    except Exception:
        auc = 0.0
    cm = confusion_matrix(y_te, pred, labels=[0, 1, 2])

    meta = {
        "model_version": MODEL_VERSION,
        "training_mode": mode,
        "real_samples": real_n,
        "synthetic_samples": synth_n,
        "label_distribution": label_distribution(y.tolist()),
        "metrics": {"accuracy": round(float(acc), 3), "macro_f1": round(float(f1.mean()), 3), "auc": round(float(auc), 3)},
    }
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    names = ["low", "medium", "high"]
    print(f"[train] 模型已保存: {MODEL_PATH}  ({MODEL_VERSION}) mode={mode} real={real_n} synth={synth_n}")
    print(f"[train] test 集规模: {len(y_te)}  | Accuracy: {acc:.3f}  | Macro-F1: {f1.mean():.3f}  | AUC-OVR: {auc:.3f}")
    for i, n in enumerate(names):
        print(f"  {n:6s} precision={p[i]:.3f} recall={r[i]:.3f} f1={f1[i]:.3f}")
    print("[train] 混淆矩阵 (true\\pred: low/med/high):")
    print(cm)
    print("[train] ⚠️ 生活方式风险预测：标签冷启动规则/问卷标签，非医学标注，不用于诊断。")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--real-db", default=None, help="真实 SQLite 库路径（含 health_survey 表）")
    args = ap.parse_args()
    train(args.real_db)
