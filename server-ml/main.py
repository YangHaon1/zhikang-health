"""
FastAPI 服务入口。
POST /predict  输入健康特征，输出亚健康风险等级 + SHAP 解释。

⚠️ 边界：本服务只做生活方式风险分级，不输出任何疾病诊断。
"""
from __future__ import annotations
from fastapi import FastAPI
from pydantic import BaseModel
from model import predict, MODEL_VERSION
from explain import explain
from cluster_predict import cluster_predict

app = FastAPI(title="zhikang sub-health predictor", version=MODEL_VERSION)


class PredictReq(BaseModel):
    # 只声明文档样例字段；实际接收任意特征 dict（缺失用默认值）
    features: dict


@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.post("/predict")
def predict_route(req: PredictReq):
    raw = req.features or {}
    result = predict(raw)
    return {
        "riskLevel": result["riskLevel"],
        "riskProbability": result["riskProbability"],
        "dataQuality": result["dataQuality"],
        "shapFactors": explain(raw),
        "modelVersion": MODEL_VERSION,
        "disclaimer": "结果为生活方式风险提示，不构成医学诊断。",
    }


@app.post("/cluster")
def cluster_route(req: PredictReq):
    return cluster_predict(req.features or {})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
