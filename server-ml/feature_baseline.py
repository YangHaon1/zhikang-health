"""
训练分布基线产物生成（P1-1 线上线下特征一致性治理）。

产出 `model/feature-baseline.json`：每个特征的分箱边界 + 训练集占比 + 参考统计量，
供 PSI（Population Stability Index）漂移检测使用。

为什么需要它：
  线上特征与训练分布不一致是模型失效最常见的静默原因 —— 预测照样返回数字，
  只是数字不再可信。没有基线就无法回答「今天的输入还像不像训练时的输入」。
  基线不预测对错，只负责把"输入已经漂了"这件事如实暴露出来。

⚠️ 本模块只写 `model/feature-baseline.json`，不加载/不重训任何模型，
   绝不触碰 `lgbm.txt` / `metadata.json`（重训会改变演示结论，报告明确禁止）。
"""
from __future__ import annotations
import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from feature import FEATURE_ORDER, FEATURE_LABELS, FEATURE_UNITS  # noqa: E402
from feature import FEATURE_SPEC, SPEC_PATH  # noqa: E402

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model")
BASELINE_PATH = os.path.join(MODEL_DIR, "feature-baseline.json")

# 与 train.py 同源：训练数据的生成种子与样本量。
# 基线必须描述"模型实际见过的数据"，因此这里直接调用 train.make_synth()，
# 而不是另写一个生成器（另写就等于又造了一份会漂移的定义）。
MODEL_SEED = 42
MODEL_SAMPLES = 4000
BINS = 10

# 取值本来就离散/极少的特征：用「每个不同取值一个箱」，
# 强上分位数会把 is_off_campus 这种 0/1 特征切成 10 个空箱，PSI 失去意义。
DISCRETE_MAX_DISTINCT = 8


def _bin_edges(col: np.ndarray) -> list[float]:
    """分箱边界（含最小/最大值），保证严格递增，供 np.digitize 使用。"""
    distinct = np.unique(col)
    if distinct.size <= DISCRETE_MAX_DISTINCT:
        edges = distinct.astype(float).tolist()
    else:
        qs = np.quantile(col, np.linspace(0, 1, BINS + 1))
        edges = sorted({float(q) for q in qs})
    if len(edges) < 2:
        # 常量列：造一个退化的单箱，PSI 恒为 0（没有分布可言）
        edges = [float(edges[0]) - 0.5, float(edges[0]) + 0.5] if edges else [0.0, 1.0]
    return edges


def _proportions(col: np.ndarray, edges: list[float]) -> list[float]:
    """按 edges 分箱后的样本占比（与 feature_drift 的 stats() 同一套规则）。"""
    if len(edges) < 2:
        return [1.0]
    idx = np.digitize(col, np.asarray(edges[1:-1], dtype=float), right=False)
    counts = np.bincount(idx, minlength=len(edges) - 1).astype(float)
    total = counts.sum()
    if total <= 0:
        return [1.0] * (len(edges) - 1)
    return [float(c / total) for c in counts]


def build_baseline() -> dict:
    from train import make_synth

    X, y = make_synth(n=MODEL_SAMPLES)
    refs = []
    for j, key in enumerate(FEATURE_ORDER):
        col = X[:, j]
        edges = _bin_edges(col)
        props = _proportions(col, edges)
        refs.append(
            {
                "feature": key,
                "label": FEATURE_LABELS[key],
                "unit": FEATURE_UNITS.get(key, ""),
                "bin_edges": [round(e, 6) for e in edges],
                "proportions": [round(p, 6) for p in props],
                "reference_median": round(float(np.median(col)), 4),
                "reference_mean": round(float(np.mean(col)), 4),
                "reference_min": round(float(np.min(col)), 4),
                "reference_max": round(float(np.max(col)), 4),
            }
        )

    # 标签分布也留一份：线上若长期偏向某一档，说明输入或阈值已经漂了。
    level_counts = {str(k): int(v) for k, v in zip(*np.unique(y, return_counts=True))}

    return {
        "baseline_version": "feature-baseline-v1",
        "spec_path": os.path.relpath(SPEC_PATH, os.path.dirname(os.path.dirname(MODEL_DIR))),
        "feature_spec_version": FEATURE_SPEC.get("spec_version", "unknown"),
        "provenance": {
            "source": "train.make_synth()，与 model/lgbm.txt 的训练数据同一生成器",
            "seed": MODEL_SEED,
            "samples": MODEL_SAMPLES,
            "bins": BINS,
            "discrete_max_distinct": DISCRETE_MAX_DISTINCT,
            "caveat": (
                "当前模型为 synthetic_only 冷启动：基线描述的是合成训练数据。"
                "改用真实问卷重训后，train.py 会用真实特征重算并覆盖本文件，"
                "届时基线才代表真实人群分布。"
            ),
        },
        "label_distribution": level_counts,
        "features": refs,
    }


def _write(data: dict) -> str:
    os.makedirs(MODEL_DIR, exist_ok=True)
    with open(BASELINE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return BASELINE_PATH


def write_baseline() -> str:
    """生成并落盘基線产物，返回文件路径（train.py 训练完会调用一次）。"""
    return _write(build_baseline())


if __name__ == "__main__":
    _data = build_baseline()
    _write(_data)
    print(f"[baseline] 已写入 {BASELINE_PATH}")
    print(
        f"[baseline] 特征数 {len(_data['features'])}"
        f"（来自 {MODEL_SAMPLES} 条 seed={MODEL_SEED} 合成样本）"
    )
