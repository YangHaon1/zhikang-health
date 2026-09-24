/**
 * C6 竞赛优化：健康提醒 + 可访问性 + 移动端适配单元测试。
 *
 * 覆盖三块：
 * 1. **提醒**：类型目录、时刻校验与归一化、默认值（默认关闭）、设置行归一化、
 *    到点判定与下次触发、站内提醒文案、投递渠道清单（未来接真实推送的接口位）。
 *    提醒的**读写与调度**要碰数据库，因此不在这里测，改由接口实测覆盖
 *    （`GET/PUT /api/health/reminders` + 调度器扫描结果）——与 C5 审计的做法一致。
 * 2. **可访问性口径**：表单标签完整（新增指标必然带标签）、分级 / 变化方向的
 *    符号与文字齐全（颜色不作唯一载体）。
 * 3. **静态断言**：直接读五个核心页的源码，断言断点、标签绑定、aria 与图表明细
 *    确实落在页面上 —— 这类「约定」没有运行时表现，只能对源码断言。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_REMINDER_CHANNEL,
  DEFAULT_REMINDER_ENABLED,
  DEFAULT_REMINDER_TIMES,
  DEFAULT_REMINDER_TIME,
  REMINDER_CHANNELS,
  REMINDER_DESCRIPTIONS,
  REMINDER_KINDS,
  REMINDER_KIND_OPTIONS,
  REMINDER_LABELS,
  REMINDER_NOTE,
  REMINDER_SCAN_INTERVAL_MS,
  REMINDER_SCHEDULE_NOTE,
  TIME_OF_DAY_HINT,
  buildReminderNotice,
  dueReminders,
  isDueToday,
  isReminderKind,
  localDateKey,
  localTimeKey,
  minutesOfDay,
  nextFireAt,
  nextFireText,
  normalizeReminders,
  normalizeTimeOfDay,
  isValidTimeOfDay
} from "../health-reminder.js";
import type { ReminderSetting } from "../health-reminder.js";
import {
  GRADE_MARKS,
  MOBILE_BREAKPOINT,
  PLAN_ARIA_FIELDS,
  PLAN_FIELD_LABELS,
  RECORD_FIELD_LABELS,
  RECORD_LABELED_FIELDS,
  RISK_DELTA_MARKS,
  RISK_DELTA_TEXT,
  SCORE_DIRECTION_HINT,
  SCORE_DIRECTION_MARKS,
  SCORE_DIRECTION_TEXT,
  gradeMark,
  riskDeltaMark,
  riskDeltaText,
  scoreDirectionMark,
  scoreDirectionText
} from "../health-a11y.js";

// ---------- 工具 ----------

/** 构造一个本地时刻的 Date，避免测试依赖运行时的真实时间 */
function at(hour: number, minute: number, day = 15): Date {
  return new Date(2026, 8, day, hour, minute, 0, 0);
}

function setting(partial: Partial<ReminderSetting>): ReminderSetting {
  return { kind: "measure", enabled: false, time: "08:00", ...partial };
}

/** 读前端页面源码（静态断言用）；路径从测试文件回溯到仓库根 */
function pageSource(relative: string): string {
  return readFileSync(
    path.resolve(import.meta.dirname, "../../..", relative),
    "utf8"
  );
}

const PAGES = {
  dashboard: "src/views/health/dashboard/index.vue",
  records: "src/views/health/records/index.vue",
  report: "src/views/health/report/index.vue",
  plans: "src/views/health/plans/index.vue",
  authorizations: "src/views/health/authorizations/index.vue"
} as const;

// ---------- 提醒类型目录 ----------

describe("提醒类型目录", () => {
  it("恰好是测量提醒与打卡提醒两类", () => {
    expect([...REMINDER_KINDS]).toEqual(["measure", "checkin"]);
  });

  it("每个类型都有中文文案与用途说明", () => {
    for (const kind of REMINDER_KINDS) {
      expect(REMINDER_LABELS[kind]).toBeTruthy();
      expect(REMINDER_DESCRIPTIONS[kind]).toBeTruthy();
    }
    expect(REMINDER_LABELS.measure).toBe("测量提醒");
    expect(REMINDER_LABELS.checkin).toBe("打卡提醒");
  });

  it("选项与目录一一对应（前端表单直接用，不会漏类型）", () => {
    expect(REMINDER_KIND_OPTIONS).toHaveLength(REMINDER_KINDS.length);
    expect(REMINDER_KIND_OPTIONS.map(o => o.value)).toEqual([
      ...REMINDER_KINDS
    ]);
    expect(REMINDER_KIND_OPTIONS.map(o => o.label)).toEqual(
      REMINDER_KINDS.map(k => REMINDER_LABELS[k])
    );
  });

  it("isReminderKind 只认目录内的类型", () => {
    expect(isReminderKind("measure")).toBe(true);
    expect(isReminderKind("checkin")).toBe(true);
    expect(isReminderKind("sleep")).toBe(false);
    expect(isReminderKind("")).toBe(false);
  });
});

// ---------- 时刻校验与归一化 ----------

describe("每日时刻校验与归一化", () => {
  it("合法写法统一归一到 HH:mm", () => {
    expect(normalizeTimeOfDay("08:00")).toBe("08:00");
    expect(normalizeTimeOfDay("8:00")).toBe("08:00");
    expect(normalizeTimeOfDay(" 9:05 ")).toBe("09:05");
    expect(normalizeTimeOfDay("23:59")).toBe("23:59");
    expect(normalizeTimeOfDay("00:00")).toBe("00:00");
    expect(normalizeTimeOfDay("7:30")).toBe("07:30");
  });

  it("全角冒号也接受（移动端中文输入法容易打出来）", () => {
    expect(normalizeTimeOfDay("8：00")).toBe("08:00");
    expect(normalizeTimeOfDay("20：30")).toBe("20:30");
  });

  it("越界与畸形写法一律非法（24:00 不是一天中的时刻）", () => {
    for (const bad of [
      "24:00",
      "23:60",
      "25:00",
      "8",
      "8:0",
      "0800",
      "08-00",
      "abc",
      "",
      "   ",
      "08:00:00",
      -1,
      800,
      null,
      undefined,
      {},
      [],
      true
    ]) {
      expect(normalizeTimeOfDay(bad)).toBeNull();
    }
  });

  it("isValidTimeOfDay 与 normalizeTimeOfDay 同一判定", () => {
    expect(isValidTimeOfDay("8:00")).toBe(true);
    expect(isValidTimeOfDay("24:00")).toBe(false);
    expect(isValidTimeOfDay(null)).toBe(false);
  });

  it("minutesOfDay 换算正确，非法返回 null", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("08:30")).toBe(510);
    expect(minutesOfDay("23:59")).toBe(1439);
    expect(minutesOfDay("24:00")).toBeNull();
  });

  it("错误提示文案点明区间与示例（与实现同源，不会写歪）", () => {
    expect(TIME_OF_DAY_HINT).toContain("00:00");
    expect(TIME_OF_DAY_HINT).toContain("23:59");
    expect(TIME_OF_DAY_HINT).toContain("08:00");
  });

  it("本地日 / 本地时刻口径与 Date 一致", () => {
    expect(localDateKey(at(0, 5, 3))).toBe("2026-09-03");
    expect(localTimeKey(at(7, 4))).toBe("07:04");
  });
});

// ---------- 默认值与设置行归一化 ----------

describe("提醒默认值与设置行归一化", () => {
  it("默认关闭（缺失行 = 未开启，老数据零迁移）", () => {
    expect(DEFAULT_REMINDER_ENABLED).toBe(false);
  });

  it("没有任何行时补齐两个类型且都是关闭状态", () => {
    const list = normalizeReminders([]);
    expect(list).toHaveLength(REMINDER_KINDS.length);
    expect(list.every(s => s.enabled === false)).toBe(true);
    expect(list.map(s => s.time)).toEqual([
      DEFAULT_REMINDER_TIMES.measure,
      DEFAULT_REMINDER_TIMES.checkin
    ]);
  });

  it("只存了一行时另一类型仍补齐（前端永远拿到两个类型）", () => {
    const list = normalizeReminders([
      { kind: "checkin", enabled: 1, time_of_day: "21:30" }
    ]);
    const measure = list.find(s => s.kind === "measure")!;
    const checkin = list.find(s => s.kind === "checkin")!;
    expect(checkin).toEqual({ kind: "checkin", enabled: true, time: "21:30" });
    expect(measure.enabled).toBe(false);
    expect(measure.time).toBe(DEFAULT_REMINDER_TIMES.measure);
  });

  it('enabled 取值口径：1 / "1" / true 开启，其余关闭', () => {
    const on = [1, "1", true];
    const off = [0, "0", null, undefined];
    for (const v of on) {
      expect(
        normalizeReminders([{ kind: "measure", enabled: v as never }])[0]
          .enabled
      ).toBe(true);
    }
    for (const v of off) {
      expect(
        normalizeReminders([{ kind: "measure", enabled: v as never }])[0]
          .enabled
      ).toBe(false);
    }
  });

  it("库内时刻非法时回落到该类型默认时刻（不把脏值透给前端）", () => {
    const list = normalizeReminders([
      { kind: "measure", enabled: 1, time_of_day: "25:99" }
    ]);
    expect(list[0].time).toBe(DEFAULT_REMINDER_TIMES.measure);
  });

  it("库内时刻归一化（8:00 在返回时变成 08:00）", () => {
    expect(
      normalizeReminders([
        { kind: "measure", enabled: 1, time_of_day: "8:00" }
      ])[0].time
    ).toBe("08:00");
  });

  it("未知类型的行被忽略，不会多出第三个类型", () => {
    const list = normalizeReminders([
      { kind: "sleep", enabled: 1, time_of_day: "22:00" }
    ]);
    expect(list.map(s => s.kind)).toEqual([...REMINDER_KINDS]);
  });

  it("不修改入参", () => {
    const rows = [{ kind: "measure", enabled: 1, time_of_day: "8:00" }];
    normalizeReminders(rows);
    expect(rows[0].time_of_day).toBe("8:00");
  });
});

// ---------- 到点判定与下次触发 ----------

describe("到点判定与下次触发", () => {
  it("到点与已过点都算「今天到点」（补发语义，见 REMINDER_SCHEDULE_NOTE）", () => {
    expect(isDueToday("08:00", at(8, 0))).toBe(true);
    expect(isDueToday("08:00", at(8, 1))).toBe(true);
    expect(isDueToday("08:00", at(23, 59))).toBe(true);
    expect(isDueToday("08:00", at(7, 59))).toBe(false);
    expect(isDueToday("08:00", at(0, 0))).toBe(false);
  });

  it("非法时刻永远不算到点（脏数据不会触发提醒）", () => {
    expect(isDueToday("25:00", at(23, 59))).toBe(false);
    expect(isDueToday(null, at(23, 59))).toBe(false);
  });

  it("nextFireAt：未到点取今日，已过点取明日", () => {
    const today = nextFireAt("20:00", at(9, 0))!;
    expect(today.getDate()).toBe(15);
    expect(today.getHours()).toBe(20);
    expect(today.getMinutes()).toBe(0);

    const tomorrow = nextFireAt("08:00", at(9, 0))!;
    expect(tomorrow.getDate()).toBe(16);
    expect(tomorrow.getHours()).toBe(8);
  });

  it("nextFireText 只说「今日 / 明日 + 时刻」", () => {
    expect(nextFireText("20:00", at(9, 0))).toBe("今日 20:00");
    expect(nextFireText("08:00", at(9, 0))).toBe("明日 08:00");
    expect(nextFireText("25:00", at(9, 0))).toBe("");
  });

  it("dueReminders 只取「已开启且到点」的，且不改入参顺序", () => {
    const list = [
      setting({ kind: "measure", enabled: true, time: "08:00" }),
      setting({ kind: "checkin", enabled: false, time: "08:00" }),
      setting({ kind: "checkin", enabled: true, time: "20:00" })
    ];
    expect(dueReminders(list, at(9, 0)).map(s => s.kind)).toEqual(["measure"]);
    expect(dueReminders(list, at(20, 30)).map(s => s.kind)).toEqual([
      "measure",
      "checkin"
    ]);
    expect(dueReminders(list, at(7, 0))).toEqual([]);
    expect(dueReminders([], at(9, 0))).toEqual([]);
  });

  it("一整天里每个时刻只会「到点」一次（分钟粒度单调）", () => {
    let hits = 0;
    for (let m = 0; m < 24 * 60; m += 1) {
      const now = at(Math.floor(m / 60), m % 60);
      if (isDueToday("12:00", now)) hits += 1;
    }
    // 12:00 之后（含）共 12 小时
    expect(hits).toBe(12 * 60);
  });
});

// ---------- 站内提醒文案 ----------

describe("站内提醒文案", () => {
  it("两个类型都产出带时刻的非空标题与正文", () => {
    for (const kind of REMINDER_KINDS) {
      const notice = buildReminderNotice(kind, "07:15")!;
      expect(notice.title).toContain(REMINDER_LABELS[kind]);
      expect(notice.title).toContain("07:15");
      expect(notice.content.length).toBeGreaterThan(10);
    }
  });

  it("未知类型返回 null（调用方不写库）", () => {
    expect(buildReminderNotice("sleep", "08:00")).toBeNull();
    expect(buildReminderNotice("", "08:00")).toBeNull();
  });

  it("时刻非法时用兜底时刻，不会出现 undefined 字面量", () => {
    const notice = buildReminderNotice("measure", "25:00")!;
    expect(notice.title).toContain(DEFAULT_REMINDER_TIME);
    expect(notice.title).not.toContain("undefined");
    expect(notice.title).not.toContain("null");
  });

  it("标题里只出现类型名与时刻，不带任何用户数据", () => {
    const notice = buildReminderNotice("checkin", "20:00")!;
    expect(notice.title).toBe(`${REMINDER_LABELS.checkin}（20:00）`);
  });
});

// ---------- 投递渠道（未来接真实推送的接口位） ----------

describe("投递渠道清单", () => {
  it("站内渠道已开通，且是当前生效渠道", () => {
    const station = REMINDER_CHANNELS.find(c => c.key === "station")!;
    expect(station.available).toBe(true);
    expect(ACTIVE_REMINDER_CHANNEL).toBe("station");
  });

  it("未开通的渠道都如实标注并说明依赖（不假装能收到）", () => {
    const unavailable = REMINDER_CHANNELS.filter(c => !c.available);
    expect(unavailable.length).toBeGreaterThan(0);
    for (const c of unavailable) {
      expect(c.description).toContain("未开通");
    }
    expect(unavailable.map(c => c.key)).toEqual(["email", "sms"]);
  });

  it("说明文案点明「演示用站内提醒」并交代其它渠道已预留", () => {
    expect(REMINDER_NOTE).toContain("演示用站内提醒");
    expect(REMINDER_NOTE).toContain("邮件");
    expect(REMINDER_NOTE).toContain("短信");
  });

  it("扫描间隔为正，且与调度说明里的秒数一致", () => {
    expect(REMINDER_SCAN_INTERVAL_MS).toBeGreaterThan(0);
    const seconds = REMINDER_SCAN_INTERVAL_MS / 1000;
    expect(Number.isInteger(seconds)).toBe(true);
    expect(REMINDER_SCHEDULE_NOTE).toContain(`${seconds} 秒`);
  });

  it("调度说明如实交代补发行为（不宣称精确定时推送）", () => {
    expect(REMINDER_SCHEDULE_NOTE).toContain("补发");
    expect(REMINDER_SCHEDULE_NOTE).toContain("不会重复");
  });
});

// ---------- 可访问性：标签与符号 ----------

describe("可访问性口径：表单标签", () => {
  it("录入页每个标签非空，且有可见标签的字段清单与标签表一一对应", () => {
    for (const label of Object.values(RECORD_FIELD_LABELS)) {
      expect(label.trim()).toBeTruthy();
    }
    expect([...RECORD_LABELED_FIELDS].sort()).toEqual(
      Object.keys(RECORD_FIELD_LABELS).sort()
    );
  });

  it("计划页每个标签非空", () => {
    for (const label of Object.values(PLAN_FIELD_LABELS)) {
      expect(label.trim()).toBeTruthy();
    }
  });

  it("组内 aria-label 字段都取自标签表（不存在凭空写的名字）", () => {
    for (const key of PLAN_ARIA_FIELDS) {
      expect(PLAN_FIELD_LABELS[key]).toBeTruthy();
    }
  });

  it("标签互不重复，且不带 placeholder 式的「选填」口吻", () => {
    const labels = [
      ...Object.values(RECORD_FIELD_LABELS),
      ...Object.values(PLAN_FIELD_LABELS)
    ];
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).not.toContain("选填");
      expect(label).not.toContain("请输入");
    }
  });
});

describe("可访问性口径：颜色不作唯一信息载体", () => {
  it("三档分级符号互不相同（灰度打印也能区分）", () => {
    expect(new Set(Object.values(GRADE_MARKS)).size).toBe(3);
    expect(gradeMark(0)).toBeTruthy();
    expect(gradeMark(1)).toBeTruthy();
    expect(gradeMark(2)).toBeTruthy();
    expect(gradeMark(9)).toBe("");
  });

  it("风险点变化三项都有文字与符号，且符号互不相同", () => {
    const kinds = ["new", "gone", "ongoing"] as const;
    for (const kind of kinds) {
      expect(RISK_DELTA_TEXT[kind]).toBeTruthy();
      expect(RISK_DELTA_MARKS[kind]).toBeTruthy();
      expect(riskDeltaText(kind)).toBe(RISK_DELTA_TEXT[kind]);
      expect(riskDeltaMark(kind)).toBe(RISK_DELTA_MARKS[kind]);
    }
    expect(new Set(kinds.map(k => RISK_DELTA_MARKS[k])).size).toBe(3);
  });

  it("评分变化三个方向都有文字与符号", () => {
    const directions = ["improved", "worsened", "stable"] as const;
    for (const d of directions) {
      expect(SCORE_DIRECTION_TEXT[d]).toBeTruthy();
      expect(scoreDirectionText(d)).toBe(SCORE_DIRECTION_TEXT[d]);
      expect(scoreDirectionMark(d)).toBe(SCORE_DIRECTION_MARKS[d]);
    }
  });

  it("符号语义跟着「风险分」走：好转是 ▼（风险分降低），恶化是 ▲", () => {
    expect(scoreDirectionMark("improved")).toBe("▼");
    expect(scoreDirectionMark("worsened")).toBe("▲");
    // 方向文案本身必须与风险分语义一致，不能只靠颜色区分
    expect(SCORE_DIRECTION_TEXT.improved).toBe("好转");
    expect(SCORE_DIRECTION_TEXT.worsened).toBe("恶化");
    expect(SCORE_DIRECTION_TEXT.stable).toBe("持平");
  });

  it("符号含义有同屏说明，避免「▼ 却是好转」被误读", () => {
    expect(SCORE_DIRECTION_HINT).toContain("▲");
    expect(SCORE_DIRECTION_HINT).toContain("▼");
    expect(SCORE_DIRECTION_HINT).toContain("风险分");
  });

  it("未知取值不崩也不瞎猜：符号给空串，文字原样返回", () => {
    expect(scoreDirectionMark("unknown")).toBe("");
    expect(scoreDirectionText("unknown")).toBe("unknown");
    expect(riskDeltaMark("unknown" as never)).toBe("");
    expect(riskDeltaText("unknown" as never)).toBe("unknown");
  });
});

// ---------- 静态断言：源码层的约定 ----------

describe("静态断言：移动端断点", () => {
  it(`五个核心页都声明了 ${MOBILE_BREAKPOINT}px 断点的媒体查询`, () => {
    for (const [name, file] of Object.entries(PAGES)) {
      const source = pageSource(file);
      const re = new RegExp(`@media[^{]*width\\s*<=\\s*${MOBILE_BREAKPOINT}px`);
      expect(
        re.test(source),
        `${name} 缺少 ${MOBILE_BREAKPOINT}px 媒体查询`
      ).toBe(true);
    }
  });

  it("断点常量只有一个值，且说明文案与之同源", () => {
    expect(MOBILE_BREAKPOINT).toBe(768);
  });
});

describe("静态断言：录入页与计划页控件均有标签", () => {
  it("录入页每个字段都绑定了共享标签表（而不是硬编码文案）", () => {
    const source = pageSource(PAGES.records);
    for (const key of RECORD_LABELED_FIELDS) {
      expect(
        source.includes(`:label="RECORD_FIELD_LABELS.${key}"`),
        `录入页字段 ${key} 没有绑定 RECORD_FIELD_LABELS.${key}`
      ).toBe(true);
      // 同一份文案不允许再以裸 label 的形式出现一遍（否则改了共享层页面不跟着变）
      expect(
        source.includes(`label="${RECORD_FIELD_LABELS[key]}"`),
        `录入页字段 ${key} 仍然硬编码 label 文案`
      ).toBe(false);
    }
  });

  it("计划页每个字段都绑定了共享标签表", () => {
    const source = pageSource(PAGES.plans);
    for (const key of [
      "title",
      "riskKey",
      "targetValue",
      "startDate",
      "endDate",
      "tasks"
    ]) {
      expect(
        source.includes(`:label="PLAN_FIELD_LABELS.${key}"`),
        `计划页字段 ${key} 没有绑定 PLAN_FIELD_LABELS.${key}`
      ).toBe(true);
    }
  });

  it("计划页任务编辑器里共处一个表单项的三个控件各自带 aria-label", () => {
    const source = pageSource(PAGES.plans);
    for (const key of PLAN_ARIA_FIELDS) {
      expect(
        source.includes(`:aria-label="PLAN_FIELD_LABELS.${key}"`),
        `任务编辑器控件 ${key} 没有 aria-label`
      ).toBe(true);
    }
  });

  it("两个表单在小屏下把标签改为顶部对齐（120px 右对齐标签在 375px 下太挤）", () => {
    for (const file of [PAGES.records, PAGES.plans]) {
      const source = pageSource(file);
      expect(source).toContain("isNarrow ? 'top' : 'right'");
    }
  });

  it("录入页每个指标都带分级符号（灰色打印也能区分三档）", () => {
    const source = pageSource(PAGES.records);
    expect(source).toContain("gradeMark(");
    // 有分级的项数与符号出现次数一致（每处都同时给符号与文字）
    const tags = source.match(/gradeMark\(grades\.\w+\.level\)/g) ?? [];
    expect(tags.length).toBe(8);
  });
});

describe("静态断言：报告页对比区非颜色信息与图表明细", () => {
  const source = pageSource(PAGES.report);

  it("评分变化同时给出方向文字与符号", () => {
    expect(source).toContain("scoreDirectionText(report.comparison.direction)");
    expect(source).toContain("scoreDirectionMark(report.comparison.direction)");
  });

  it("符号含义说明与风险点变化文字都落在页面上", () => {
    expect(source).toContain("SCORE_DIRECTION_HINT");
    expect(source).toContain("RISK_DELTA_TEXT[d.kind]");
    expect(source).toContain("riskDeltaMark(d.kind)");
  });

  it("对比区不再自留一份风险点文案（文案只在共享层定义一次）", () => {
    expect(source).not.toContain("RISK_KIND_TEXT");
  });

  it("三张图表都有 role=img 与 aria-label（图形不是唯一读法）", () => {
    const roleImg = source.match(/role="img"/g) ?? [];
    expect(roleImg.length).toBe(3);
    const ariaLabel = source.match(/:aria-label="`/g) ?? [];
    expect(ariaLabel.length).toBeGreaterThanOrEqual(3);
  });

  it("雷达图与趋势图旁都有表格明细（含表头与数值）", () => {
    expect(source).toContain('label="指标"');
    expect(source).toContain("风险指数(0-100)");
    expect(source).toContain('label="日期"');
    expect(source).toContain("收缩压(mmHg)");
    expect(source).toContain("舒张压(mmHg)");
    expect(source).toContain("空腹血糖(mmol/L)");
    // 明细表用同一个 el-table，未测指标显式画「—」而不是留空
    expect(source).toContain("fmtNum(row.systolic)");
    expect(source).toContain("fmtNum(row.fastingGlucose)");
  });

  it("时间轴图表的文本替代指向右侧「报告历史」列表（同一数据源）", () => {
    expect(source).toContain("报告历史");
    expect(source).toContain("明细见右侧");
  });
});

describe("静态断言：首页图表与授权中心开关", () => {
  it("首页趋势图带 role=img 与 aria-label", () => {
    const source = pageSource(PAGES.dashboard);
    expect(source).toContain('role="img"');
    expect(source).toContain(":aria-label=");
  });

  it("授权开关用 aria-labelledby 指向同页标题（无可见文字标签的控件也要有名）", () => {
    const source = pageSource(PAGES.authorizations);
    expect(source).toContain('id="share-switch-title"');
    expect(source).toContain('aria-labelledby="share-switch-title"');
    expect(source).toContain("允许他人查看我的健康数据");
  });
});

describe("静态断言：窄屏下用 JS 断点处理的组件属性", () => {
  it("计划页抽屉与对话框宽度按断点切换（固定 480px / 640px 会超出 375px 视口）", () => {
    const source = pageSource(PAGES.plans);
    expect(source).toContain(':size="drawerSize"');
    expect(source).toContain(':width="dialogWidth"');
    expect(source).toContain("useNarrowScreen");
    expect(source).not.toContain('size="480px"');
    expect(source).not.toContain('width="640px"');
  });

  it("授权中心表格列宽按断点切换（min-width 是属性，媒体查询管不到）", () => {
    const source = pageSource(PAGES.authorizations);
    expect(source).toContain(':min-width="colWidths.description"');
    expect(source).toContain("useNarrowScreen");
  });

  it("断点判定挂在媒体查询上，且随组件卸载解除监听", () => {
    const source = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../src/views/health/composables/useNarrowScreen.ts"
      ),
      "utf8"
    );
    expect(source).toContain("window.matchMedia");
    expect(source).toContain("addEventListener");
    expect(source).toContain("removeEventListener");
    expect(source).toContain("onBeforeUnmount");
  });
});
