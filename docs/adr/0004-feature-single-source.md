# ADR-0004：特征定义单一来源 —— 一份 JSON 契约，两侧读、不许各写各的

- 状态：已采纳
- 日期：2026-09-25
- 相关代码：`server-ml/feature-spec.json`、`server-ml/feature.py`、
  `server/src/services/featureSource.ts`、`server-ml/feature_baseline.py`、
  `server-ml/feature_drift.py`、`server/src/services/featureDrift.ts`

## 背景

同一个模型输入有 15 个特征，而这个清单曾被**四处独立维护**：
Python 的 `FEATURE_ORDER`、`dataset._default_row` 的默认值、
Node 的 `buildFeatures`、以及聚类侧的缺失判定。实际已经漂移：

| 漂移点   | 表现                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 默认值   | `dataset._default_row` 写 `grade_code: 1`，`feature.FEATURE_DEFAULTS` 写 `3`，都自称同一口径 |
| 缺失判定 | 聚类侧只判 `None/空串`，漏掉"0 只可能是没填"，与风险模型填出的输入不同                       |
| 字段注释 | `FEATURE_DEFAULTS` 注释说"取自中位数"，实测三个字段与真中位数差 1（生成均值才是真的）        |

## 决策

1. **`server-ml/feature-spec.json` 是唯一定义源**，包含 `feature_order` /
   `feature_labels` / `feature_units` / `feature_defaults` / `zero_valid` / `key_fields`。
2. Python 在 import 时读它并**自检字段完整性**（缺字段直接抛错，不静默降级）；
   `dataset.py` 的默认值改为 `dict(FEATURE_DEFAULTS)`，不再有第二份。
3. Node 通过 `server/src/services/featureSource.ts` 读**同一个文件**；
   `toModelFeatures()` 只做「字段缺失立刻报错 + `undefined` 归一为 `null`」，
   **不自己填默认值**——填充口径只允许存在于 `feature.build_features` 一处。
4. **默认值的出处写在 spec 里**（`defaults_provenance`），包括
   "这不是严格中位数，实测中位数是多少"这一如实说明。

## 理由

- 四种语言/位置的"同一份清单"必然漂移，唯一可靠的治理是**物理上只有一份**。
- 缺失判定同时决定「模型吃什么」与「前端显示已填多少」，必须同源，
  否则会出现"界面说 4/4 已填、模型吃的是填充值"的互相矛盾。
- 出处必须可核对：本项目已经吃过一次"注释断言与实测不符"的教训
  （轮廓系数事件），因此默认值这种关键常量必须写清来源与偏差。

## 被否方案

- **在 TS 里再写一份常量 + 测试保证同步**：测试能发现漂移，但漂移本身仍然存在，
  且新增字段时要改两处；不如直接读同一文件。
- **让 Python 读 TS**：Python 侧无 TS 运行时，不可行；反向（TS 读 JSON）成本最低。

## 影响

- ML 服务的 `feature.py` 现在依赖 `feature-spec.json` 存在；文件缺失会**启动即失败**
  （而不是跑出错误结果）——这是刻意的：宁可起不来，也不要静默用错特征。
- 修改特征必须同时考虑：spec、`train.py` 重新训练、基线重算。
  `train.py` 现在会自动调用 `feature_baseline.write_baseline()` 刷新漂移基线，
  避免"模型换了、基线还是老的"这种监控失明。
