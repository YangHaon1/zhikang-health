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
python main.py       # 启动 http://127.0.0.1:8000
```

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
