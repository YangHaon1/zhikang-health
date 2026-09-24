"""
V2.2 P1-1：从 health_survey 导出聚类用行为特征矩阵。
与 dataset.py 口径一致，缺失用安全默认值。
"""
from __future__ import annotations
import os
import sqlite3
from feature import FEATURE_ORDER


def _default_row() -> dict:
    return {
        "sleep_hours_mean": 7.2, "sleep_below7_days": 3, "sleep_quality_avg": 2.2,
        "exercise_min_sum": 120.0, "exercise_days": 3, "stress_avg": 1.9,
        "stress_high_days": 1.5, "diet_reg_ratio": 0.6, "mood_avg": 2.1,
        "study_hours": 7.0, "sedentary_hours": 8.0, "bedtime_hour": 23.0,
        "is_off_campus": 0, "grade_code": 1, "bmi": 20.5,
    }


def survey_to_features(r: sqlite3.Row) -> dict:
    row = _default_row()
    g = lambda k: r[k] if (k in r.keys() and r[k] is not None) else None
    if g("sleep_hours_avg") is not None: row["sleep_hours_mean"] = float(g("sleep_hours_avg"))
    if g("stay_up_freq") is not None: row["sleep_below7_days"] = int(g("stay_up_freq"))
    if g("sleep_quality") is not None: row["sleep_quality_avg"] = float(g("sleep_quality"))
    if g("exercise_times") is not None: row["exercise_days"] = int(g("exercise_times"))
    if g("exercise_min") is not None:
        row["exercise_min_sum"] = float(g("exercise_min")) * max(1, int(g("exercise_times") or 0))
    if g("study_pressure") is not None: row["stress_avg"] = float(g("study_pressure"))
    if g("exam_pressure") is not None: row["stress_high_days"] = float(g("exam_pressure"))
    if g("mood_state") is not None: row["mood_avg"] = float(g("mood_state"))
    if g("diet_regular") is not None: row["diet_reg_ratio"] = float(g("diet_regular")) / 2.0
    if g("sedentary_hours") is not None: row["sedentary_hours"] = float(g("sedentary_hours"))
    return row


def load_survey_features(db_path: str) -> list[dict]:
    if not db_path or not os.path.exists(db_path):
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM health_survey").fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
    return [survey_to_features(r) for r in rows]
