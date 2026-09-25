"""
PSI（Population Stability Index）漂移判定 —— 与 TypeScript 侧 server/src/services/featureDrift.ts
使用完全相同的分箱与计算规则（分箱边界来自 model/feature-baseline.json，两侧都不自己造边界）。

判定阈值（业界通用口径，非本项目的自定义发明）：
  PSI < 0.10        稳定
  0.10 ≤ PSI < 0.25 轻微漂移（值得关注）
  PSI ≥ 0.25        显著漂移（建议重训/排查上游特征）

⚠️ 这是「输入分布」的监控，不是模型精度监控。PSI 大只说明线上输入不再像训练数据，
   不代表预测一定错；PSI 小也不代表预测一定对。出现在看板上时必须如实这么讲。
"""
from __future__ import annotations
import os
import json
import numpy as np

BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "feature-baseline.json")

# 防止除零：某箱在线上/训练任一侧占比为 0 时，用极小值替代后仍可算出有限数值
EPS = 1e-4

STABLE_MAX = 0.10
WATCH_MAX = 0.25


def load_baseline(path: str = BASELINE_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def bin_index(value: float, edges: list[float]) -> int:
    """值 → 箱号。低于首边界归 0，高于末边界归最后一箱（越界本身就是重要信号）。"""
    if len(edges) < 2:
        return 0
    inner = edges[1:-1]
    return int(np.digitize([value], np.asarray(inner, dtype=float), right=False)[0])


def actual_proportions(values: list[float], edges: list[float]) -> list[float]:
    n_bins = max(1, len(edges) - 1)
    counts = [0] * n_bins
    for v in values:
        counts[bin_index(float(v), edges)] += 1
    total = sum(counts)
    if total <= 0:
        return [0.0] * n_bins
    return [c / total for c in counts]


def psi(reference: list[float], actual: list[float]) -> float:
    """PSI = Σ (A% - E%) · ln(A% / E%)，两侧占比都做 EPS 截断。"""
    if len(reference) != len(actual):
        raise ValueError(f"分箱数不一致: reference={len(reference)} actual={len(actual)}")
    total = 0.0
    for e, a in zip(reference, actual):
        e2 = max(float(e), EPS)
        a2 = max(float(a), EPS)
        total += (a2 - e2) * float(np.log(a2 / e2))
    return float(total)


def level_of(value: float) -> str:
    if value >= WATCH_MAX:
        return "significant"
    if value >= STABLE_MAX:
        return "watch"
    return "stable"


def drift_report(
    live: dict[str, list[float]], baseline: dict | None = None, min_samples: int = 30
) -> dict:
    """
    live: {feature_key: [线上实测值...]}（缺失的特征跳过）。
    min_samples: 样本太少时 PSI 本身不可信 —— 必须如实标注，不能拿 10 个点当结论。
    """
    base = baseline if baseline is not None else load_baseline()
    refs = base.get("features", [])
    checked = 0
    features = []
    for ref in refs:
        key = ref["feature"]
        values = live.get(key) or []
        checked = max(checked, len(values))
        if not values:
            features.append(
                {
                    "feature": key,
                    "label": ref.get("label", key),
                    "unit": ref.get("unit", ""),
                    "psi": None,
                    "level": "no_data",
                    "samples": 0,
                    "actualMedian": None,
                    "referenceMedian": ref.get("reference_median"),
                }
            )
            continue
        value = psi(ref["proportions"], actual_proportions(values, ref["bin_edges"]))
        features.append(
            {
                "feature": key,
                "label": ref.get("label", key),
                "unit": ref.get("unit", ""),
                "psi": round(value, 4),
                "level": level_of(value),
                "samples": len(values),
                "actualMedian": round(float(np.median(values)), 4),
                "referenceMedian": ref.get("reference_median"),
            }
        )

    scored = [f for f in features if f["psi"] is not None]
    worst = max(scored, key=lambda f: f["psi"]) if scored else None
    return {
        "baselineVersion": base.get("baseline_version", "unknown"),
        "trainedWith": base.get("provenance", {}).get("source", "unknown"),
        "level": worst["level"] if worst else "no_data",
        "maxPsi": worst["psi"] if worst else None,
        "maxPsiFeature": worst["feature"] if worst else None,
        "samples": checked,
        "sufficient": checked >= min_samples,
        "thresholds": {"stable": STABLE_MAX, "watch": WATCH_MAX},
        "features": features,
    }


if __name__ == "__main__":
    # 自检 1：拿基线自己喂自己，PSI 必须为 0（分箱与计算口径自洽）
    b = load_baseline()
    print(f"[drift] baseline={b['baseline_version']} features={len(b['features'])}")
    print(f"[drift] provenance={b['provenance']['source']} seed={b['provenance']['seed']} n={b['provenance']['samples']}")

    rng = np.random.default_rng(0)
    live_same = {}
    live_shifted = {}
    for ref in b["features"]:
        key = ref["feature"]
        edges = ref["bin_edges"]
        lo, hi = edges[0], edges[-1]
        # 用基线自身占比做多项抽样 → 分布同源，PSI 应接近 0
        props = np.asarray(ref["proportions"], dtype=float)
        props = props / props.sum()
        draws = rng.choice(len(props), size=4000, p=props)
        mids = [
            (edges[i] + edges[i + 1]) / 2 if i + 1 < len(edges) else edges[i]
            for i in range(len(props))
        ]
        live_same[key] = [float(mids[i]) for i in draws]
        # 人为右移半箱 → 分布漂了，PSI 应显著大于 0
        live_shifted[key] = [
            float(min(hi, lo + (v - lo) * 1.5 + (hi - lo) * 0.1)) for v in live_same[key]
        ]

    same = drift_report(live_same, b)
    shifted = drift_report(live_shifted, b)
    print(f"[drift] 同源抽样 → maxPsi={same['maxPsi']} level={same['level']}（期望 stable且psi≈0）")
    print(f"[drift] 人为漂移 → maxPsi={shifted['maxPsi']} level={shifted['level']}（期望 significant）")
