/**
 * V2.0 P1-1B：ML 预测服务客户端。
 * 调独立 FastAPI 服务（server-ml），失败/超时一律抛出，由路由层降级到规则引擎。
 * 不改动 health-engine，不阻塞主流程。
 */

/**
 * SHAP 单条归因。
 * factor/label/value/direction/description 由 Python explain.py 直接产出，
 * 方向取自【被预测类别】的 SHAP 值符号；Node 侧只透传、不做任何二次计算。
 */
export interface ShapFactor {
  /** 特征键名（如 stress_avg） */
  factor?: string;
  /** 兼容旧字段 */
  feature?: string;
  /** 中文名 */
  label: string;
  /** SHAP 贡献值（带符号） */
  value?: number;
  /** 兼容旧字段 */
  contribution?: number;
  /** raise_risk / lower_risk / unknown */
  direction: string;
  /** 面向用户的一句话说明 */
  description?: string;
}

export interface RiskPrediction {
  riskLevel: "low" | "medium" | "high" | "unknown";
  riskProbability: number;
  dataQuality: { level: string; filledRatio: number };
  shapFactors: ShapFactor[];
  modelVersion: string;
  /** 数据是否足以支撑预测（Python 侧判定，关键字段全缺时为 false） */
  sufficient?: boolean;
  /** 数据不足时的说明文案 */
  message?: string;
}

const ML_BASE = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";
const TIMEOUT_MS = 2500;

/**
 * 调 /predict。失败（连不上/超时/非200/字段缺失）一律抛错，
 * 调用方据此降级规则引擎。
 */
export async function predictRisk(
  features: Record<string, number>
): Promise<RiskPrediction> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${ML_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error(`ML http ${resp.status}`);
    const data = (await resp.json()) as Record<string, unknown>;
    if (!data.riskLevel) throw new Error("ML 响应缺少 riskLevel");
    return {
      riskLevel: data.riskLevel as RiskPrediction["riskLevel"],
      riskProbability: Number(data.riskProbability) || 0,
      dataQuality: (data.dataQuality as RiskPrediction["dataQuality"]) ?? {
        level: "unknown",
        filledRatio: 0
      },
      shapFactors: (data.shapFactors as ShapFactor[]) ?? [],
      modelVersion: String(data.modelVersion ?? "unknown"),
      sufficient: data.sufficient !== false,
      message: typeof data.message === "string" ? data.message : undefined
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ClusterResult {
  available: boolean;
  clusterId?: number;
  name?: string;
  description?: string;
  confidence?: number;
  modelVersion?: string;
}

/** 调 /cluster 行为画像。失败抛错，调用方降级规则分型。 */
export async function predictCluster(
  features: Record<string, number>
): Promise<ClusterResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${ML_BASE}/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error(`ML cluster http ${resp.status}`);
    return (await resp.json()) as ClusterResult;
  } finally {
    clearTimeout(timer);
  }
}
