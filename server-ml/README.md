# server-ml · 大学生亚健康风险预测服务

独立 Python 服务（FastAPI + LightGBM + SHAP），与主 Node 项目解耦。

## 用途

根据大学生的生活方式数据（睡眠/运动/压力/饮食/作息/久坐/学习时长），
输出**生活方式型亚健康风险分级**与可解释因素。

## ⚠️ 风险边界

- 本服务输出的是**生活方式风险提示**，**不是疾病诊断**。
- 当前 demo 标签由规则引擎冷启动生成，非医学标注。
- 结果不可用于任何医疗决策，不替代专业诊疗。

## 运行

```bash
pip install -r requirements.txt
python train.py      # 生成 model/lgbm.txt（冷启动演示模型）
python clustering.py # 生成 cluster-model/kmeans.pkl（ lifestyle 行为聚类）
python main.py       # 启动 http://127.0.0.1:8000
```

### 复现训练（锁定版本）

`requirements.txt` 只保证「能跑」，不保证「跑出和仓库里一样的结果」。
仓库提交的产物是在下列版本下训练的，**重训前请锁到这些版本**：

```bash
python -m venv .venv && .venv/Scripts/python.exe -m pip install \
  "numpy==1.26.4" "scikit-learn==1.7.2" "lightgbm==4.3.0" "pandas==2.2.3"
```

为什么必须锁 `scikit-learn`：KMeans / StandardScaler 的 pickle 格式跨大版本会变，
用 1.9.x 加载 1.7.2 训练的模型会报 `InconsistentVersionWarning`，簇中心可能漂移，
`metadata.json` 里记录的 `silhouette`、各簇 `count` / `center` 就对不上了。

> 现场演示**不要**临时重训：合成数据的随机种子固定（train.py `random_state`、
> clustering.py `default_rng(7)`），锁版本下结果可复现；但换台机器、换个 Python
> 小版本就可能漂移。演示用仓库里已提交的模型产物即可。

## 聚类质量：如何正确解读 silhouette 0.066

`cluster-model/metadata.json` 记录的 `silhouette = 0.066`，绝对值偏低（经验上 <0.1
算「簇间分离弱」）。这不是记录错误，而是合成数据的真实性质，实测复算如下
（口径与 `clustering.py` 完全一致：同一批合成数据 → 同一个 `StandardScaler`
→ 同一个 `kmeans.pkl` 的 `labels_` → sklearn `silhouette_score`）：

| 指标                      | 值                                            |
| ------------------------- | --------------------------------------------- |
| k=3 实测轮廓系数          | **+0.0661**                                   |
| 元数据记录值              | 0.066（一致 ✅）                              |
| 随机标签基线（20 次均值） | −0.0060                                       |
| 相对随机基线判别力        | **+1196.6%**                                  |
| k 扫描                    | 3: 0.0661 / 4: 0.0633 / 5: 0.0561 / 6: 0.0497 |

**结论**：合成数据各特征独立生成，原始空间里不存在天然簇结构，所以绝对分值低是
预期的；但把同一批标签随机打乱后轮廓系数掉到 −0.006（低于 0 表示簇比随机划分还差），
说明**模型确实抓到了真实的结构性差异**，而不是把噪声硬分成几堆。k=3 在扫描区间内
最优，不需要调 k，也不需要为了提分「重训」。

> ⚠️ 不要试图把 0.066「优化」上去——那只能靠改展示数据或换指标口径，属于自欺。
> 真实数据进来（≥100 份问卷）后分值自然会变，届时重跑 `clustering.py --real-db` 即可。

## 用真实问卷数据训练（ML-03）

冷启动阶段标签由规则引擎生成，模型属于「工程闭环验证」而非医学标注。
一旦收集到真实问卷，不需要改代码，只需让训练脚本读到它：

1. 前端提交问卷后数据落在 `server/data/zhikang.db` 的 `health_survey` 表（标签字段
   `lifestyle_risk_label` 同样由规则引擎填写）；
2. 管理员调用 `POST /api/health/survey/export-dataset`，服务端导出
   `server-ml/real_survey.db`（字段与源表一致，可直接被 `dataset.load_real_dataset` 读取）；
3. 用导出集重训：

```bash
python train.py       --real-db server-ml/real_survey.db
python clustering.py  --real-db server-ml/real_survey.db
```

`training_mode` 会自动切换（阈值与导出接口共用同一套，写在 `train.py` / `clustering.py`）：

| 真实样本数 | training_mode                           | 含义                                  |
| ---------- | --------------------------------------- | ------------------------------------- |
| 0~19       | `synthetic_only` / `synthetic_fallback` | 纯合成数据                            |
| 20~99      | `hybrid_training`                       | 真实与合成混合训练                    |
| ≥100       | `real_priority`                         | 真实数据优先，合成数据只补足到 800 条 |

当前状态可用 `GET /api/health/survey/dataset-status` 查询（真实样本数、下次训练模式、还差几条）。
前端「大学生健康调研洞察」卡片下方也会如实展示，包含不利指标也不隐藏。

> ⚠️ 注意：`real_priority` 只说明"用了真实数据"，标签本身仍来自规则引擎，
> 在换成量表（如 PSSQ / GHQ-12）人工标注之前，模型结论依然只是**生活方式风险提示**。
> 这一点在答辩时应主动说明，不要声称"已用真实医疗标注训练"。

## API

### POST /predict

```json
{
  "features": {
    "sleep_hours_mean": 5.5,
    "sleep_below7_days": 5,
    "stress_avg": 2.8,
    "sedentary_hours": 11,
    "exercise_min_sum": 30
  }
}
```

响应：

```json
{
  "riskLevel": "high | medium | low",
  "riskProbability": 0.62,
  "dataQuality": { "level": "high", "filledRatio": 1.0 },
  "shapFactors": [
    {
      "feature": "stress_avg",
      "label": "平均压力",
      "contribution": 0.21,
      "direction": "raise_risk"
    }
  ],
  "modelVersion": "lgbm-v0.1-demo",
  "disclaimer": "结果为生活方式风险提示，不构成医学诊断。"
}
```

## 文件

- `feature.py`：特征向量 + 数据质量
- `train.py`：合成数据 + 规则标签训练
- `model.py`：加载/预测
- `explain.py`：SHAP Top3（失败自动回退特征重要性）
- `main.py`：FastAPI 接口
