"""
FastAPI 服务入口。
POST /predict  输入健康特征，输出亚健康风险等级 + SHAP 解释。

⚠️ 边界：本服务只做生活方式风险分级，不输出任何疾病诊断。
"""
from __future__ import annotations
from fastapi import FastAPI
from pydantic import BaseModel
from model import predict, model_version
from explain import explain
from cluster_predict import cluster_predict

app = FastAPI(title="zhikang sub-health predictor", version=model_version())


class PredictReq(BaseModel):
    # 只声明文档样例字段；实际接收任意特征 dict（缺失用训练集统计值填充）
    features: dict


@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": model_version()}


@app.post("/predict")
def predict_route(req: PredictReq):
    raw = req.features or {}
    result = predict(raw)
    payload = {
        "riskLevel": result["riskLevel"],
        "riskProbability": result["riskProbability"],
        "dataQuality": result["dataQuality"],
        "sufficient": result["sufficient"],
        "modelVersion": result["modelVersion"],
        "disclaimer": "结果为生活方式风险提示，不构成医学诊断。",
    }
    # 数据不足时不返回 SHAP：此时任何归因都是对填充值的解释，没有意义
    if result["sufficient"]:
        payload["shapFactors"] = explain(raw)
    else:
        payload["shapFactors"] = []
        payload["message"] = result["message"]
    return payload


@app.post("/cluster")
def cluster_route(req: PredictReq):
    return cluster_predict(req.features or {})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
