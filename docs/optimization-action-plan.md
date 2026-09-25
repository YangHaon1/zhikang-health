# 智康健康 · 逐文件优化改动清单

> 配套文档：`docs/project-review-report.md`（问题定位与证据）
> 本清单把每一个待修问题精确到 **文件 → 行号 → 当前代码 → 改成什么 → 怎么验证**。
> 按 P0-1 ~ P0-10 顺序执行即可，每一项都可独立验收。

---

## 0. 执行前准备

```bash
# 建一个修复分支，不要直接在 main 上改
git checkout -b fix/p0-review

# 确认基线是好的（改之前先跑一次，改完对比）
pnpm test                      # 期望 376 passed
cd server && pnpm typecheck    # 期望无错误
```

> ⚠️ **提交规范**（见 `AGENTS.md`）：commit subject 必须中性小写开头，禁止大写拉丁字母开头（commitlint 限制）。例如 `fix(ml): 模型文件改用 lf 存储` ✅ / `Fix(model): ...` ❌。

---

## P0-1　模型文件被 Git CRLF 破坏（最致命，先做这个）

**影响**：Windows 上克隆仓库后 LightGBM 无法加载模型 → AI 风险预测静默降级为规则引擎。

### 改动 1：`.gitattributes`

**当前内容**（全文）：

```
public/wasm/capture.worker.js linguist-language=Vue
public/wasm/index.js linguist-language=Vue
```

**改为**（追加）：

```
public/wasm/capture.worker.js linguist-language=Vue
public/wasm/index.js linguist-language=Vue

# 模型 & 二进制产物：禁止 Git 做 CRLF 转换
# lgbm.txt 一旦被转成 CRLF，LightGBM 会报 "Model format error, expect a tree here"
server-ml/model/*.txt -text
server-ml/model/*.json -text
server-ml/cluster-model/* -text
*.pkl binary
```

### 改动 2：把已损坏的 `lgbm.txt` 恢复为 LF

```bash
cd server-ml
python -c "p='model/lgbm.txt'; b=open(p,'rb').read(); open(p,'wb').write(b.replace(b'\r\n', b'\n'))"
```

### 改动 3：让 Git 重新归一化并提交

```bash
git add --renormalize .
git commit -m "fix(ml): 模型文件改用 lf 存储并在 gitattributes 标记 -text"
```

### 验证（必须做）

```bash
# 1) 换行符已恢复
python -c "b=open('server-ml/model/lgbm.txt','rb').read(); print('CRLF',b.count(b'\r\n'),'LF',b.count(b'\n'))"
# 期望：CRLF 0   LF 6995

# 2) 模型能加载（最关键的验收点）
python -c "import lightgbm as lgb; b=lgb.Booster(model_file='server-ml/model/lgbm.txt'); print('num_trees', b.num_trees())"
# 期望：num_trees 360

# 3) 模拟"评委在 Linux 上重新克隆"的验证
cd /tmp && git clone <你的仓库> zhikang-check
cd zhikang-check && python -c "import lightgbm as lgb; print(lgb.Booster(model_file='server-ml/model/lgbm.txt').num_trees())"
```

**工作量**：30 分钟　**风险**：极低（只改换行符与 gitattributes，不动逻辑）

---

## P0-2　SHAP 方向计算错误（已错误展示给用户，优先修）

**位置**：`server-ml/explain.py`

**当前问题**（第 29-44 行）：

```python
def explain(raw: dict, k: int = 3):
    x = np.array([build_features(raw)])
    factors = []
    try:
        exp = _get_explainer()
        sv = exp.shap_values(x)[0]
        # 三分类时 sv 可能是 (features, classes)，取被预测类
        contrib = (sv.mean(axis=1) if sv.ndim == 2 else sv)   # ❌ 取了所有类的平均
        order = np.argsort(-np.abs(contrib))
        for i in order[:k]:
            factors.append({
                "feature": FEATURE_ORDER[i],
                "label": FEATURE_LABELS[FEATURE_ORDER[i]],
                "contribution": round(float(contrib[i]), 4),
                "direction": "raise_risk" if contrib[i] > 0 else "lower_risk",
            })
    except Exception:
        # 回退：按全局 gain 重要性
        imp = _get_importance()
        order = np.argsort(-imp)
        for i in order[:k]:
            factors.append({
                "feature": FEATURE_ORDER[i],
                "label": FEATURE_LABELS[FEATURE_ORDER[i]],
                "contribution": round(float(imp[i]), 2),
                "direction": "raise_risk",                     # ❌ 降级时方向全是假的
            })
    return factors
```

**改为**（整段替换）：

```python
def _predicted_class(x: np.ndarray) -> int:
    """取模型对本样本的预测类别，用于挑选对应类别的 SHAP 贡献。"""
    proba = _load().predict(x)[0]
    return int(np.asarray(proba).argmax())


def explain(raw: dict, k: int = 3):
    """
    SHAP Top-K 归因。
    多分类下必须取【被预测类别】那一列的 shap 值；取全类平均会让正负贡献相互抵消，
    出现「睡 8 小时 = 升高风险」这类反直觉结论。
    """
    x = np.array([build_features(raw)])
    factors = []
    try:
        exp = _get_explainer()
        sv = exp.shap_values(x)
        # shap 新版返回 list[ndarray(n_features,)] * n_classes，老版返回 ndarray
        if isinstance(sv, list):
            per_class = np.stack(sv, axis=-1)      # (n_features, n_classes)
        else:
            per_class = np.asarray(sv)
            if per_class.ndim == 3:
                per_class = per_class[0]
        if per_class.ndim == 2:
            contrib = per_class[:, _predicted_class(x)]
        else:
            contrib = per_class
        order = np.argsort(-np.abs(contrib))[:k]
        for i in order:
            factors.append({
                "feature": FEATURE_ORDER[i],
                "label": FEATURE_LABELS[FEATURE_ORDER[i]],
                "contribution": round(float(contrib[i]), 4),
                "direction": "raise_risk" if contrib[i] > 0 else "lower_risk",
            })
    except Exception:
        # 回退：只有全局 gain 重要性，没有方向信息，必须如实标注 unknown
        imp = _get_importance()
        order = np.argsort(-np.asarray(imp))[:k]
        for i in order:
            factors.append({
                "feature": FEATURE_ORDER[i],
                "label": FEATURE_LABELS[FEATURE_ORDER[i]],
                "contribution": round(float(imp[i]), 2),
                "direction": "unknown",
            })
    return factors
```

### 同步改动：前端处理 `unknown` 方向

**位置**：`src/views/health/risk/index.vue`（第 208-215 行附近）

当前文案逻辑只有「↑ 升高风险 / ↓ 降低风险」两态，遇到 `unknown` 会走 else 显示成"降低风险"。改为：

```vue
<span
  class="dir"
  :class="dirClass(f.direction)"
>{{ dirText(f.direction) }}</span>
```

```ts
const dirText = (d: string) =>
  d === "raise_risk"
    ? "↑ 升高风险"
    : d === "lower_risk"
      ? "↓ 降低风险"
      : "· 影响方向待定";
const dirClass = (d: string) =>
  d === "raise_risk" ? "up" : d === "lower_risk" ? "down" : "unknown";
```

### 验证

```bash
cd server-ml
python -c "
from explain import explain
healthy = dict(sleep_hours_mean=8, sleep_below7_days=0, sleep_quality_avg=3,
  exercise_min_sum=300, exercise_days=5, stress_avg=1, stress_high_days=0,
  diet_reg_ratio=1, mood_avg=3, study_hours=6, sedentary_hours=5,
  bedtime_hour=22.5, is_off_campus=0, grade_code=3, bmi=21)
for f in explain(healthy): print(f['label'], f['contribution'], f['direction'])
"
```

**验收标准**：健康人（睡 8h、压力 1）不应再出现「睡眠时长 / 平均压力 = raise_risk」。修复前实测为 +0.76 / +0.47 `raise_risk`，修复后应转为 `lower_risk` 或贡献值显著减小。

**工作量**：1.5 小时　**风险**：低（仅影响解释输出，不影响预测等级）

---

## P0-3　评分不做归一化 → 三级高血压判「低风险」

**位置**：`server/shared/health-engine.ts` 第 594-601 行

**当前代码**：

```ts
// 加权得分：正常 0、警戒 50%、异常 100%
let score = 0;
(Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach(key => {
  const l = categories[key];
  if (l === null) return;
  score += WEIGHTS[key] * (l === 2 ? 1 : l === 1 ? 0.5 : 0);
});
score = Math.round(score);
```

**改为**：

```ts
// 加权得分：正常 0、警戒 50%、异常 100%
// 只按【已测量】的指标归一化：未测指标既不贡献分数，也不进分母，
// 避免「测的项目越少 → 总分越低 → 看起来越健康」的方向性错误。
let weighted = 0;
let measured = 0;
(Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach(key => {
  const l = categories[key];
  if (l === null) return;
  measured += WEIGHTS[key];
  weighted += WEIGHTS[key] * (l === 2 ? 1 : l === 1 ? 0.5 : 0);
});
let score = measured > 0 ? Math.round((weighted / measured) * 100) : 0;

// 安全保底：任一单项达到「异常」(level 2) 时，总评不得低于「中」(30 分)。
// 防止单个危急值（如血压 200/120）被其它未测项稀释成「低风险」。
const hasSevere = Object.values(categories).some(l => l === 2);
if (hasSevere) score = Math.max(score, 30);
```

### 顺带修：让 AnalyzeResult 暴露「已测项数量」

`buildEvidence` 里补一项，让前端能显示"基于 N 项指标"（提升可解释性，也是答辩加分点）：

```ts
// 在 buildEvidence 返回的 evidence 对象中增加
measuredCount: Object.values(categories).filter(l => l !== null).length,
```

### 验证

```bash
cd server && pnpm typecheck
pnpm test     # 期望仍全绿；若有断言失败，见下方说明
```

新增两条黄金用例（建议加到 `server/shared/__tests__/health-engine.test.ts`）：

```ts
it("仅测血压 200/120 时不得判为低风险", () => {
  const r = analyzeHealth(
    [{ date: "2026-09-20", systolic: 200, diastolic: 120 } as any],
    null
  );
  expect(r.score).toBeGreaterThanOrEqual(30);
  expect(r.level).not.toBe("低");
});

it("未测项不进分母：只测一项正常值时分数不应虚低", () => {
  const r = analyzeHealth(
    [{ date: "2026-09-20", systolic: 110, diastolic: 70 } as any],
    null
  );
  expect(r.score).toBe(0); // 单项正常 → 0 分，而不是被 75 分未测权重稀释
});
```

> ⚠️ **注意**：这条改动会改变历史分数，可能有存量测试断言失败（例如 `health-engine.test.ts` 里某些 `toBeGreaterThanOrEqual(25)` 之类的弱断言）。**失败是正常的**，请按新的正确语义更新断言，不要为了让测试变绿而回退修复。

**工作量**：2 小时（含测试调整）　**风险**：中（影响全站评分，需回归）

---

## P0-4　急症分流：假阳性 + 阈值缺口

**位置**：`server/shared/health-engine.ts`

### 改动 1：加否定词窗口（第 739-773 行 `checkEmergency`）

在第 684 行（`EMERGENCY_SYMPTOMS` 定义结束后）插入：

```ts
/**
 * 否定 / 非当前 / 非本人 语境词。
 * 「我没有胸痛」「家人有抽搐史」这类表述不是「正在发生的急症」，
 * 直接命中有两个危害：① 用户被误导；② 真正触发时用户已不再相信该提示。
 */
const NEGATION_HINTS = [
  "没有",
  "没出现",
  "不是",
  "不存在",
  "已缓解",
  "已经好了",
  "已好转",
  "以前",
  "曾经",
  "去年",
  "家人",
  "朋友",
  "同学",
  "同事",
  "担心",
  "会不会",
  "预防"
];

/** 关键词前 8 字窗口内出现否定/非本人语境 → 判为非当前急症 */
function isNegated(q: string, word: string): boolean {
  const idx = q.indexOf(word);
  if (idx < 0) return false;
  const window = q.slice(Math.max(0, idx - 8), idx);
  return NEGATION_HINTS.some(h => window.includes(h));
}
```

把第 761-762 行：

```ts
  for (const [word, why] of EMERGENCY_SYMPTOMS) {
    if (q.includes(word)) {
```

改为：

```ts
  for (const [word, why] of EMERGENCY_SYMPTOMS) {
    if (q.includes(word) && !isNegated(q, word)) {
```

### 改动 2：补低血压 / 心率阈值（第 687-723 行 `EMERGENCY_INDICATORS`）

在数组末尾追加：

```ts
  {
    key: "systolic",
    name: "收缩压",
    check: v => v <= 90,
    reason: v => `收缩压 ${v} mmHg（≤90，提示休克或严重低血压）`
  },
  {
    key: "diastolic",
    name: "舒张压",
    check: v => v <= 60,
    reason: v => `舒张压 ${v} mmHg（≤60，提示休克或严重低血压）`
  },
  {
    key: "heartRate",
    name: "心率",
    check: v => v < 40 || v > 130,
    reason: v => `心率 ${v} 次/分（<40 或 >130）`
  },
  {
    key: "fastingGlucose",
    name: "空腹血糖",
    check: v => v >= 33.3,
    reason: v => `空腹血糖 ${v} mmol/L（≥33.3，提示高渗高血糖状态）`
  }
```

### 改动 3（可选，建议做）：心理危机分流

心理危机的处置步骤不是"打 120"，需要独立分支。在 `checkEmergency` 的第 2 步之前插入：

```ts
// 1.5) 心理危机（处置步骤与躯体急症不同，走心理援助通道）
const CRISIS_WORDS = ["不想活", "轻生", "自杀", "结束生命"];
const crisis = CRISIS_WORDS.find(w => q.includes(w) && !isNegated(q, w));
if (crisis) {
  return {
    kind: "symptom",
    reason: `您的问题中提到「${crisis}」，这提示您可能正处于心理危机中。`,
    steps: [
      "1. 请立刻联系身边可信任的人（家人、朋友、辅导员），不要独自承受；",
      "2. 拨打全国 24 小时心理援助热线 12356，或当地心理危机干预热线；",
      "3. 联系学校心理咨询中心预约紧急面谈；",
      "4. 如已有自伤计划或行为，请立即拨打 120 或前往急诊。"
    ],
    boundary: BOUNDARY_TEXT
  };
}
```

### 验证

```bash
pnpm test
# 建议新增用例（server/shared/__tests__/c0-safety.test.ts）：
```

```ts
it("否定表述不应触发急症卡", () => {
  expect(checkEmergency("我没有胸痛，就是有点累")).toBeNull();
  expect(checkEmergency("家人有抽搐史，我需要担心吗")).toBeNull();
});
it("肯定的急症表述仍应触发", () => {
  expect(checkEmergency("我现在胸痛得厉害")).not.toBeNull();
});
it("低血压应触发", () => {
  expect(
    checkEmergency("我头晕", { systolic: 80, diastolic: 50 } as any)
  ).not.toBeNull();
});
```

**工作量**：2.5 小时　**风险**：低

---

## P0-5　全零特征被判「高风险 90.4%」

涉及两个文件：**Node 侧特征构造** 与 **Python 侧缺失值填充**。

### 改动 1：`server/src/routes/health/risk.ts` 第 78-84 行

**当前**：

```ts
    study_hours: sp?.study_hours ?? 0,
    sedentary_hours: sp?.sedentary_hours ?? 0,
    bedtime_hour: bedtimeHour,
    is_off_campus: 0,
    grade_code: 3,
    bmi
```

**改为**（缺失传 `null`，由 Python 侧填训练集中位数；`is_off_campus`/`grade_code` 改为真实取值）：

```ts
    // 缺失一律传 null：由 ML 侧按训练集中位数填充，避免 0 值被当成"极端行为"解读
    study_hours: sp?.study_hours ?? null,
    sedentary_hours: sp?.sedentary_hours ?? null,
    bedtime_hour: sp?.bedtime ? bedtimeHour : null,
    is_off_campus: sp?.is_off_campus ?? null,
    grade_code: gradeCodeOf(sp?.grade),
    bmi: bmi || null
```

同文件顶部（`buildFeatures` 之前）新增年级映射：

```ts
/** 年级文本 → 训练用的 grade_code（与合成数据 1..6 对齐） */
const GRADE_CODE: Record<string, number> = {
  大一: 1,
  大二: 2,
  大三: 3,
  大四: 4,
  研一: 5,
  研二: 6,
  研三: 6
};
function gradeCodeOf(grade?: string): number | null {
  return grade ? (GRADE_CODE[grade] ?? null) : null;
}
```

### 改动 2：`server/src/routes/health/risk.ts` — 增加「数据不足」守卫

`buildFeatures` 目前只返回特征。改为同时返回记录天数：

```ts
function buildFeatures(userId: number): {
  features: Record<string, number | null>;
  days: number;
} { ... return { features: {...}, days: days.length }; }
```

路由处（第 119-122 行）：

```ts
router.get("/health/risk", authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const { features, days } = buildFeatures(userId);

  // 近 7 天没有任何每日记录时不做预测：模型在空输入上会给出无意义的 high 风险
  if (days === 0) {
    res.json({
      code: 0,
      message: "数据不足，请先记录健康数据",
      data: {
        source: "insufficient",
        riskLevel: "unknown",
        riskProbability: 0,
        dataQuality: { level: "insufficient", filledRatio: 0 },
        shapFactors: [],
        modelVersion: "none",
        healthType: null,
        modelExplain: { featureImportance: [] },
        features
      }
    });
    return;
  }
  ...
```

### 改动 3：`server-ml/feature.py` — 缺失值填中位数而非 0

**当前**（第 49-60 行）：

```python
def build_features(raw: dict) -> list[float]:
    out: list[float] = []
    for k in FEATURE_ORDER:
        v = raw.get(k)
        if v is None:
            v = 0
        out.append(float(v))
    return out
```

**改为**：

```python
# 训练集中位数（与 dataset._default_row 对齐）。
# 缺失必须填中位数而非 0：0 在训练分布里是极端值（如就寝 0 点、BMI 0），
# 会让模型把「没填数据」误判成「极端不健康」。
FEATURE_MEDIANS = {
    "sleep_hours_mean": 7.2, "sleep_below7_days": 3, "sleep_quality_avg": 2.2,
    "exercise_min_sum": 120.0, "exercise_days": 3, "stress_avg": 1.9,
    "stress_high_days": 1.5, "diet_reg_ratio": 0.6, "mood_avg": 2.1,
    "study_hours": 7.0, "sedentary_hours": 8.0, "bedtime_hour": 23.0,
    "is_off_campus": 0, "grade_code": 3, "bmi": 20.5,
}

def build_features(raw: dict) -> list[float]:
    out: list[float] = []
    for k in FEATURE_ORDER:
        v = raw.get(k)
        if v is None or v == "":
            v = FEATURE_MEDIANS[k]
        out.append(float(v))
    return out
```

> ⚠️ **权衡说明**：`exercise_min_sum = 0`（真的没运动）会被当成缺失填成 120。
> 若想精确区分，把"真 0"与"未填"用 `null` 区分开——Node 侧已经在做（`?? null`），
> 前端表单里"运动 0 分钟"应显式提交 `0` 而不是不提交。

### 验证

```bash
# Python 侧
cd server-ml && python -c "
from model import predict
zeros = {k: None for k in ['sleep_hours_mean','sleep_below7_days','sleep_quality_avg',
  'exercise_min_sum','exercise_days','stress_avg','stress_high_days','diet_reg_ratio',
  'mood_avg','study_hours','sedentary_hours','bedtime_hour','is_off_campus','grade_code','bmi']}
print(predict(zeros))
"
# 验收标准：riskLevel 应为 low/medium，绝不应是 high；修复前为 high + 0.904

# Node 侧
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/health/risk
# 清空 daily 数据后应返回 source: "insufficient"
```

**工作量**：2 小时　**风险**：中（需同步改 buildFeatures 返回值，涉及调用点）

---

## P0-6　README 架构图与启动步骤补全

> ✅ **本项已由我直接完成**，见仓库根 `README.md`。补齐内容：
>
> - 架构图加入 Python ML 服务层（LightGBM / SHAP / KMeans）
> - 核心功能补充「AI 风险预测 / 行为画像 / 三段式 AI 辅助 / RAG 知识增强」
> - 快速开始增加「启动 ML 服务」步骤，并说明不启动时的降级行为
> - 新增「已知限制」章节，如实说明冷启动模型边界
> - 环境变量表补充 `ML_SERVICE_URL`

---

## P0-7　真实问卷数据采集与重训（非代码改动，但决定答辩成败）

### 步骤

```bash
# 1) 导出问卷（建议做成静态页或问卷星），字段对齐 health_survey：
#    sleep_hours_avg / sleep_quality / stay_up_freq / study_pressure /
#    exam_pressure / mood_state / exercise_times / exercise_min /
#    breakfast / diet_regular / sedentary_hours / phone_hours
# 2) 导入到库（users 表已有 3 个账号，问卷可挂在 common 账号下）
# 3) 重训模型
cd server-ml
python train.py --real-db ../server/data/zhikang.db
#    真实样本 ≥100 时自动切换 real_priority 模式
python clustering.py --real-db ../server/data/zhikang.db

# 4) 检查生成的新指标
cat model/metadata.json
cat cluster-model/metadata.json     # 重点看 silhouette 是否 > 0.2
```

### 强烈建议：用真实量表替换规则标签

当前 `services/survey-label.ts` 是 6 项规则打分，**标签仍是规则**。若时间允许，改用成熟量表可显著提升可信度：

| 量表                        | 测什么   | 题量 | 适配的特征    |
| --------------------------- | -------- | ---- | ------------- |
| **PSQI** 匹兹堡睡眠质量指数 | 睡眠质量 | 19   | sleep_*       |
| **PSS-10** 知觉压力量表     | 压力     | 10   | stress_*      |
| **GHQ-12** 一般健康问卷     | 心理健康 | 12   | mood / stress |
| **IPAQ 短卷**               | 身体活动 | 7    | exercise_*    |

把量表得分按常模分档（如 PSQI > 7 = 睡眠障碍）作为 `lifestyle_risk_label`，**这才是真正的医学标注**，答辩时的说服力完全不同。

### 验收标准

- `model/metadata.json` 的 `real_samples` ≥ 100、`training_mode` = `real_priority`
- 重训后指标若下降（很可能从 0.98 降到 0.7 左右）——**这是好事**，说明模型开始学真实规律了。把这个变化写进 `docs/model-report.md`，是非常有说服力的答辩素材。

**工作量**：采集 1-2 周（可并行）　**风险**：无

---

## P0-8　清理前端「假 AI」展示

| #   | 文件:行号                                                 | 当前问题                                                                                                         | 改法                                                                                                           |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 8-1 | `src/views/health/ai-profile/index.vue:55-63`             | 三个 `<div class="step done">` 硬编码 `done`，与实际是否走 LLM 无关                                              | 删除进度条；或改为根据 `source === "ai"` 显示「AI 生成」/「规则生成」徽标                                      |
| 8-2 | `src/views/health/report/index.vue:450-479`               | 三段"AI 生成过程"进度由 `trend.length>0` / `radar.length>=3` / `suggestions.length>0` 伪造；后端实为一次同步计算 | 整块删除，或改为静态说明「报告由规则引擎实时计算生成」                                                         |
| 8-3 | `src/components/health/ai/HealthFactorChart.vue:8-21, 33` | 用正则数关键词出现次数当"影响因素强度"，柱宽 `count*50%`                                                         | 改用后端下发的真实贡献度（`modelExplain.featureImportance`）；无数据时显式显示"暂无归因数据"而非画空图         |
| 8-4 | `src/views/health/showcase/index.vue:138`                 | 硬编码"AI 能力模块 5"，实际卡片只有 4 项                                                                         | 改为 `{{ caps.length }}`                                                                                       |
| 8-5 | `src/views/health/dashboard/index.vue:224-262`            | 五维画像 `8/4、60/0、85/60/35、88/62/35、75` 全部硬编码，与规则引擎健康分无任何关联                              | 二选一：① 下沉到 `server/shared/` 与引擎打通；② 页面上明确标注"示意打分"，不要放在 AI 相关卡片里               |
| 8-6 | `src/views/health/analytics/index.vue:77-79`              | "AI 模型：LightGBM + KMeans" 模型名写死在模板                                                                    | 改为从 `/health/cluster-stats` + `/health/ml-train-stats` 返回的 `modelVersion` 渲染；无数据时显示"模型未加载" |

**验收**：全局搜索 `class="step done"`、`"AI 能力模块"` 确认已清理；`HealthFactorChart` 不再用正则计数。

**工作量**：3 小时　**风险**：低

---

## P0-9　RAG 路径 + 聚类 metadata 键名

### 改动 1：`server/src/services/health-knowledge.ts` 第 31 行

**当前**：

```ts
const p = path.resolve(process.cwd(), "src", "data", "health-knowledge.json");
```

（依赖 `process.cwd()`；按根 `package.json` 的 `dev:server` 从根目录启动时解析成 `<root>/src/data/...`，该目录不存在 → RAG 永久失效）

**改为**：

```ts
// 用模块自身位置定位，不依赖 process.cwd()：
// 本文件在 server/src/services/，知识库在 server/src/data/
const p = path.resolve(
  import.meta.dirname,
  "..",
  "data",
  "health-knowledge.json"
);
```

### 改动 2：聚类 metadata 键名

`server-ml/cluster-model/metadata.json` 第 2 行当前是 `"version"`，但 `cluster_predict.py:56`、`clusterStats.ts:31`、`analytics.ts:110` 读的都是 `"model_version"` → 永远回退默认值。

**最简修复**：重新训练一次即可生成正确键名（`clustering.py:128` 写入的就是 `model_version`）：

```bash
cd server-ml && python clustering.py
```

**或**手工把文件里 `"version": "kmeans-v0.2"` 改成 `"model_version": "kmeans-v0.2"`（建议两个键都保留以兼容旧代码）。

### 改动 3（建议）：顺手修 `clusterStats` 缺鉴权

`server/src/routes/health/clusterStats.ts` 第 15 行：

```ts
router.get("/health/cluster-stats", (_req, res) => {
```

改为：

```ts
import { authMiddleware } from "../../middleware/auth.js";
router.get("/health/cluster-stats", authMiddleware, (_req, res) => {
```

### 验证

```bash
# RAG：启动服务后调用一次 chat(llm 模式)，看日志/响应是否包含知识条目
# 或直接验证路径
cd server && node -e "
const p = require('path');
console.log(p.resolve('src/services', '..', 'data', 'health-knowledge.json'));
console.log(require('fs').existsSync(p.resolve('src/services','..','data','health-knowledge.json')));
"
# 期望：true

# 聚类版本
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/health/cluster-stats
# 期望：version 字段不再是 "unknown"
```

**工作量**：1 小时　**风险**：低

---

## P0-10　Agent 闭环串联（Analyze → Plan → 落地）

### 改动 1：`server/src/routes/health/planAgent.ts` 第 9-16 行

**当前**（`summary` 是硬编码空串）：

```ts
router.post("/health/agent/plan", authMiddleware, async (req, res) => {
  const ht = analyzeHealthType(req.user!.id);
  const result = await generatePlan({
    summary: "",
    healthType: ht?.name ?? ""
  });
  res.json({ code: 0, message: "操作成功", data: result });
});
```

**改为**：

```ts
router.post("/health/agent/plan", authMiddleware, async (req, res) => {
  const ht = analyzeHealthType(req.user!.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  // 接收 Analyze Agent 输出的 summary，形成 analyze → plan 的数据依赖
  const summary =
    typeof body.summary === "string" ? body.summary.trim().slice(0, 500) : "";
  const result = await generatePlan({ summary, healthType: ht?.name ?? "" });
  res.json({ code: 0, message: "操作成功", data: result });
});
```

### 改动 2：前端 `src/views/health/risk/index.vue` 第 37-40 行

**当前**（两次调用无任何数据传递）：

```ts
const [a, p] = await Promise.all([
  getHealthAgentAnalysis(),
  getHealthAgentPlan()
]);
```

**改为**（先 analyze，再带 summary 调 plan）：

```ts
const analysis = await getHealthAgentAnalysis();
const analysisData = analysis?.data ?? null;
const plan = await getHealthAgentPlan({
  summary: analysisData?.summary ?? ""
});
```

并在 api 层 `src/api/health.ts` 的 `getHealthAgentPlan` 增加可选入参 `{ summary?: string }`（POST body）。

> 顺带修：该处 `try/finally` 没有 `catch`（见报告 FE-02），请一并补上。

### 改动 3：新增「采纳为我的计划」接口（让 Agent 结果能落地）

新建 `server/src/routes/health/planAdopt.ts`：

```ts
/** P0-10：把 Agent 生成的 7 天方案落库为真实健康计划。 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { fmtDate, addDays } from "../../../shared/health-plan.js";

const router = Router();

router.post("/health/agent/plan/adopt", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 60)
      : "AI 生成的 7 天改善计划";
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (!tasks.length) {
    res.json({ code: 40001, message: "方案中没有可执行任务" });
    return;
  }
  const today = fmtDate(new Date());
  const planId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO health_plans (user_id, title, risk_key, start_date, end_date, status, source, create_time)
       VALUES (?,?,?,?,?, 'active', 'agent', datetime('now','localtime'))`
      )
      .run(userId, title, "lifestyle", today, addDays(today, 6));
    const pid = Number(info.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO plan_tasks (plan_id, title, task_type, frequency, sort_order) VALUES (?,?,?,?,?)`
    );
    tasks.slice(0, 14).forEach((t: any, i: number) => {
      ins.run(
        pid,
        String(t.title ?? `第 ${t.day ?? i + 1} 天任务`).slice(0, 60),
        "lifestyle",
        "daily",
        i
      );
    });
    return pid;
  })();
  res.json({ code: 0, message: "已加入我的计划", data: { planId } });
});

export default router;
```

在 `server/src/routes/health/index.ts` 注册：

```ts
import planAdoptRouter from "./planAdopt.js";
...
router.use(planAdoptRouter);
```

前端 `risk/index.vue` 的 Agent 方案卡片增加一个按钮：

```vue
<el-button type="primary" size="small" :loading="adopting" @click="adoptPlan">
  采纳为我的计划
</el-button>
```

### 验证

```bash
# 1) plan 不再收到空 summary：在 health-plan-agent.ts 里临时打印 prompt，确认含 analyze 结论
# 2) 采纳后计划出现在我的计划列表
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"title":"测试方案","tasks":[{"day":1,"title":"早睡"}]}' \
  http://localhost:3000/api/health/agent/plan/adopt
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/health/plans
```

**工作量**：4 小时　**风险**：中（新增接口，需配套前端）

---

## P1　建议优化（P0 完成后再做）

| #    | 事项                                         | 关键改法                                                                                                                                                                                        | 收益                                            |
| ---- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| P1-1 | **特征一致性治理**                           | 把 `FEATURE_ORDER` 单一定义（Python + TS + 前端共用），加 PSI 漂移检测：线上特征分布 vs 训练分布，超阈值告警                                                                                    | ML 工程高阶加分项，直接回应"线上线下一致性"追问 |
| P1-2 | **聚类叙事修正**                             | 真实数据重训后 silhouette 仍 <0.2 时，前端改为展示规则分型（`health-type.ts`），并在页面注明"当前数据未形成显著行为簇"                                                                          | 诚实 > 硬撑，避免被问倒                         |
| P1-3 | **黄金测试集**                               | 在 `server/shared/__tests__/` 新增 `golden-cases.test.ts`，用手工标注的"165/100 → 应得 X 分"固定用例，替代当前"用 analyzeHealth 验证 analyzeHealth"的自证测试                                   | 防止算法缺陷再次潜伏                            |
| P1-4 | **高危前端 bug**（见报告 FE-01/02/03/06/07） | ① ECharts 提前 return 前统一 `dispose()`；② 所有 `try/finally` 补 `catch`；③ `http/index.ts:95-101` 刷新失败时遍历 `reject`；④ `pageSize` 后端加 `Math.min(x, 200)`；⑤ 报告切换加请求序号防竞态 | 现场演示稳定性                                  |
| P1-5 | **权限加固**                                 | `review-agent.ts:30-41` 的 `calcCompletion` 补 `user_id` 绑定；`seedStudent.ts` 加 `adminOnly` + 生产环境拒绝；登录接口加失败次数锁定                                                           | 安全底线                                        |
| P1-6 | **收敛重复实现**                             | BMI 公式 4 份 → 1 份（`health-score.ts:calculateBMI`）；日期格式化 7 份 → 1 份；"有效运动日"3 套口径 → 1 份（建议 `>=10 分钟`）；医学区间前后端共用 `NORMAL_RANGES`                             | 可维护性                                        |
| P1-7 | **补充 ADR 与试用报告**                      | 建 `docs/adr/` 记录关键决策（为何选 LightGBM、为何规则引擎与 LLM 解耦、为何隐私授权独立建表）；做 20-30 人试用并出前后对比                                                                      | 答辩材料厚度                                    |

---

## P2　产品化方向（赛后）

- **数据自动采集**：打通 `/health/device/sync`（当前死接口），接入手环 / 校园卡消费 / 图书馆门禁，把手工填报变被动采集——这是留存率的关键。
- **模型注册表**：建 `model_registry` 表管理版本、指标、训练数据快照，支持灰度与回滚。
- **Agent 真实化**：引入工具调用（查记录 / 写计划 / 记打卡）、会话记忆、Review 结果回灌 Plan。
- **群体健康服务**：`analytics` 模块扩展为"院系健康报告"，是 B 端商业化入口。
- **多端**：微信小程序（校园场景最合适）。

---

## 验收清单（改完逐项打勾）

```bash
# 1. 模型可加载（P0-1）
python -c "import lightgbm as lgb; print(lgb.Booster(model_file='server-ml/model/lgbm.txt').num_trees())"   # 360

# 2. SHAP 方向合理（P0-2）
#    健康人不应出现 睡眠/压力 = raise_risk

# 3. 评分保底生效（P0-3）
cd server && pnpm typecheck && pnpm test    # 全绿

# 4. 否定句不触发急救卡（P0-4）
#    checkEmergency("我没有胸痛") === null

# 5. 空数据不判高风险（P0-5）
#    /api/health/risk 在无 daily 数据时返回 source: "insufficient"

# 6. RAG 生效（P0-9）
#    chat(llm) 响应中能体现知识库内容

# 7. 聚类版本可读（P0-9）
curl .../api/health/cluster-stats          # version 非 unknown

# 8. Agent 串联（P0-10）
#    plan 的 prompt 中出现 analyze 的 summary

# 9. 端到端冒烟
pnpm dev:all     # 同时起 ML + 后端 + 前端
#    登录 → 填每日记录 → 风险页 → 计划页 → 打卡 → 复评，全流程走通

# 10. 前端构建
pnpm build       # 无错误
```

---

**清单结束**

建议执行顺序：**P0-1 → P0-2 → P0-9 → P0-5 → P0-3 → P0-4 → P0-8 → P0-10 → P0-6（已完成）→ P0-7（并行采集）**
前三项（约 3 小时）就能解决"AI 功能在评委机器上跑不起来"和"解释结果是错的"这两个最容易翻车的问题。
