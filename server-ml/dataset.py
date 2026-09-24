"""
P1-2：从 health_survey 真实问卷表导出 15 维训练特征。

⚠️ 仅做特征映射，标签取表中 lifestyle_risk_label（survey-label 规则产出）。
   这是生活方式风险标签，不构成医学诊断。
"""
from __future__ import annotations
import os
import sqlite3
from typing import Tuple, List
from feature import FEATURE_ORDER

LABEL_MAP = {"low": 0, "medium": 1, "high": 2}


def _default_row() -> dict:
    """特征缺失时的安全默认值（群体中位）。"""
    return {
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
        "grade_code": 1,
        "bmi": 20.5,
    }


def survey_row_to_features(r: sqlite3.Row) -> dict:
    """把 health_survey 一行映射到 FEATURE_ORDER。"""
    row = _default_row()
    g = lambda k, d=None: r[k] if (k in r.keys() and r[k] is not None) else d

    if g("sleep_hours_avg") is not None:
        row["sleep_hours_mean"] = float(g("sleep_hours_avg"))
    if g("stay_up_freq") is not None:
        row["sleep_below7_days"] = int(g("stay_up_freq"))
    if g("sleep_quality") is not None:
        row["sleep_quality_avg"] = float(g("sleep_quality"))
    if g("exercise_times") is not None:
        row["exercise_days"] = int(g("exercise_times"))
    if g("exercise_min") is not None:
        row["exercise_min_sum"] = float(g("exercise_min")) * max(1, int(g("exercise_times") or 0))
    if g("study_pressure") is not None:
        row["stress_avg"] = float(g("study_pressure"))
    if g("exam_pressure") is not None:
        row["stress_high_days"] = float(g("exam_pressure"))
    if g("mood_state") is not None:
        row["mood_avg"] = float(g("mood_state"))
    if g("diet_regular") is not None:
        row["diet_reg_ratio"] = float(g("diet_regular")) / 2.0
    if g("sedentary_hours") is not None:
        row["sedentary_hours"] = float(g("sedentary_hours"))
    return row


def load_real_dataset(db_path: str) -> Tuple[List[dict], List[int]]:
    """从 SQLite 导出 (feature_rows, labels)。无表/无数据返回空。"""
    if not db_path or not os.path.exists(db_path):
        return [], []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT * FROM health_survey WHERE lifestyle_risk_label IN ('low','medium','high')"
        ).fetchall()
    except sqlite3.OperationalError:
        return [], []
    finally:
        conn.close()
    feats, labels = [], []
    for r in rows:
        feats.append(survey_row_to_features(r))
        labels.append(LABEL_MAP.get(r["lifestyle_risk_label"], 1))
    return feats, labels


def label_distribution(labels: List[int]) -> dict:
    d = {"low": 0, "medium": 0, "high": 0}
    inv = {0: "low", 1: "medium", 2: "high"}
    for y in labels:
        d[inv[y]] += 1
    return d
