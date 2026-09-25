/**
 * 核心流程端到端回归（对齐真实接口）：
 *   登录 → 学生档案 → 每日记录 → 风险预测 → SHAP 解释 → AI 分析 → 计划生成 → 复评
 * 三类用户：新用户（零数据）/ 正常用户 / 高风险用户
 * 用法：npx tsx .workbuddy/tmp/e2e.mts
 */
const BASE = "http://127.0.0.1:3000/api";
const ADMIN = { username: "admin", password: "admin123" };
const TEST_PWD = "Test@123456";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL  ${name} ::`,
      typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 240)
    );
  }
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {}
) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

async function login(username: string, pwd: string): Promise<string> {
  const r = await api("/login", { method: "POST", body: { username, password: pwd } });
  if (r.json?.code !== 0) throw new Error(`login failed: ${username} ${r.text}`);
  return r.json.data.accessToken as string;
}

async function ensureUser(adminToken: string, username: string) {
  try {
    return await login(username, TEST_PWD);
  } catch {
    await api("/user", {
      method: "POST",
      token: adminToken,
      body: { username, password: TEST_PWD, nickname: username, roleIds: [2] }
    });
    return await login(username, TEST_PWD);
  }
}

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const dayAgo = (n: number) => fmt(new Date(Date.now() - n * 86400000));

async function seedStudentProfile(token: string, kind: "good" | "bad") {
  return api("/health/student-profile", {
    method: "PUT",
    token,
    body: {
      grade: "大三",
      major: "计算机科学与技术",
      isOffCampus: kind === "good" ? 0 : 1,
      bedtime: kind === "good" ? "22:40" : "01:30",
      wakeTime: kind === "good" ? "07:00" : "09:30",
      sedentaryHours: kind === "good" ? 6 : 12,
      studyHours: kind === "good" ? 6 : 11
    }
  });
}

async function seedDaily(token: string, kind: "good" | "bad", days: number) {
  let ok = 0;
  for (let i = 0; i < days; i++) {
    const r = await api("/health/daily", {
      method: "POST",
      token,
      body: {
        date: dayAgo(i),
        sleepHours: kind === "good" ? 7.8 : 5.2,
        sleepQuality: kind === "good" ? 3 : 1,
        exerciseMinutes: kind === "good" ? 40 : 4,
        stressLevel: kind === "good" ? 1 : 3,
        moodScore: kind === "good" ? 3 : 1,
        dietRegularity: kind === "good" ? "good" : "poor",
        dietStatus: kind === "good" ? "good" : "poor",
        note: ""
      }
    });
    if (r.json?.code === 0) ok++;
  }
  return ok;
}

async function runCase(
  label: string,
  username: string,
  kind: "new" | "good" | "bad",
  adminToken: string
) {
  console.log(`\n===== ${label} (${username}) =====`);
  const token = await ensureUser(adminToken, username);
  check("1. 登录获取 token", !!token);

  if (kind === "new") {
    check("2. 学生档案（跳过，保持零数据）", true);
    check("3. 每日记录（跳过，保持零数据）", true);
  } else {
    const p = await seedStudentProfile(token, kind);
    check("2. 学生档案写入", p.json?.code === 0, p.text);
    const ok = await seedDaily(token, kind, 7);
    check(`3. 近 7 天每日记录写入（成功 ${ok}/7）`, ok === 7);
  }

  // 4. 风险预测
  const risk = await api("/health/risk", { token });
  const rd = risk.json?.data ?? {};
  check("4. 风险预测接口可用", risk.json?.code === 0, risk.text);
  console.log(
    `       riskLevel=${rd.riskLevel} proba=${rd.riskProbability} source=${rd.source} model=${rd.modelVersion}`
  );
  if (kind === "new") {
    check("4a. 新用户不得被判 high", rd.riskLevel !== "high", rd);
    check(
      "4b. 新用户返回 insufficient/unknown",
      rd.source === "insufficient" || rd.riskLevel === "unknown",
      { source: rd.source, riskLevel: rd.riskLevel }
    );
  } else if (kind === "good") {
    check("4a. 正常用户不得被判 high", rd.riskLevel !== "high", rd);
  } else {
    check("4a. 高风险用户应命中 high", rd.riskLevel === "high", rd);
  }

  // 5. SHAP
  const fi: any[] = rd.modelExplain?.featureImportance ?? [];
  console.log(
    `       SHAP ${fi.length} 项: ` +
      fi
        .slice(0, 3)
        .map(
          (f: any) =>
            `${f.label}[${f.feature}]=${f.shap ?? f.value} ${f.direction}`
        )
        .join(" | ")
  );
  if (kind !== "new") {
    check("5. SHAP 因子非空", fi.length > 0, fi);
    check("5a. 因子带真实特征键（非中文退化）", fi.every((f: any) => !!f.feature), fi);
    check(
      "5b. 因子带方向说明",
      fi.every((f: any) => !!f.direction && !!f.description),
      fi
    );
    if (kind === "good")
      check(
        "5c. 正常用户不得出现「睡够=升高风险」",
        fi.filter((f: any) => f.direction === "risk_up").length === 0,
        fi
      );
    if (kind === "bad")
      check(
        "5d. 高风险用户主要因子应为 risk_up",
        fi.filter((f: any) => f.direction === "risk_up").length >= 2,
        fi
      );
  }

  // 6. AI 分析（Analyze Agent —— 规则 analyze 是 /health/analyze，无 summary 字段）
  const analyze = await api("/health/agent/analyze", { method: "POST", token });
  check("6. Analyze Agent 接口可用", analyze.json?.code === 0, analyze.text);
  const ad = analyze.json?.data ?? {};
  const summary = String(ad.summary ?? "");
  const riskOut = String(ad.currentStatus?.riskLevel ?? "");
  console.log(`       summary(${summary.length}) = ${summary.slice(0, 70)}`);
  console.log(`       riskLevel=${riskOut} keyProblems=${(ad.keyProblems ?? []).length}`);
  if (kind !== "new") {
    check("6a. summary 非空", summary.length > 0, ad);
    check("6b. 给出风险等级", !!riskOut, ad);
    check("6c. 给出关键问题清单", (ad.keyProblems ?? []).length > 0, ad);
  }

  // 7. Agent 工作流 Analyze → Plan
  const wf = await api("/health/agent/workflow", { method: "POST", token, body: {} });
  check("7. Agent 工作流接口可用", wf.json?.code === 0, wf.text);
  const steps: any[] = wf.json?.data?.steps ?? [];
  const ctx = wf.json?.data?.context ?? {};
  const plan = wf.json?.data?.plan ?? {};
  console.log(`       steps = ${steps.map((s: any) => `${s.name}:${s.source}`).join(",")}`);
  console.log(
    `       context.risk=${ctx.risk || "(空)"} summary=${String(ctx.summary || "(空)").slice(0, 40)}`
  );
  check("7a. Plan 收到 Analyze 的 risk（不得为空）", !!ctx.risk, ctx);
  check(
    "7b. Plan 收到 Analyze 的 summary（不得为空串）",
    !!ctx.summary && String(ctx.summary).length > 0,
    ctx
  );
  check("7d. 工作流步骤包含 analyze 与 plan", steps.length === 2, steps);
  if (kind !== "new") {
    check(
      "7c. 计划任务非空且由 LLM/规则生成",
      Array.isArray(plan.tasks) && plan.tasks.length > 0,
      plan
    );
  }

  // 8. 复评越权
  const f1 = await api("/health/agent/review", {
    method: "POST",
    token,
    body: { planId: 999999 }
  });
  check(
    "8. 他人/不存在 planId → 403",
    f1.status === 403 || f1.json?.code === 403,
    { status: f1.status, body: f1.text.slice(0, 120) }
  );
  const f2 = await api("/health/agent/review", {
    method: "POST",
    token,
    body: { planId: 0 }
  });
  check("8b. planId=0 → 40001", f2.json?.code === 40001, f2.text.slice(0, 120));

  // 9. 真实复评：给本用户建一条计划 → workflow 带 planId → 复评应成功
  if (kind !== "new") {
    const created = await api("/health/plans", {
      method: "POST",
      token,
      body: {
        title: "e2e 四周改善计划",
        riskKey: "sleep",
        targetValue: "睡眠 7.5 小时",
        startDate: dayAgo(0),
        endDate: dayAgo(-13),
        source: "rule",
        tasks: [
          { title: "23:30 前上床", taskType: "lifestyle", frequency: "daily" },
          { title: "快走 20 分钟", taskType: "exercise", frequency: "daily" }
        ]
      }
    });
    if (created.json?.code !== 0) {
      console.log("       (建计划失败，跳过复评)", created.text.slice(0, 100));
    } else {
      const list = await api("/health/plans", { token });
      const plans: any[] = list.json?.data ?? [];
      const mine = plans[plans.length - 1];
      const wf2 = await api("/health/agent/workflow", {
        method: "POST",
        token,
        body: { planId: mine.id }
      });
      const review = wf2.json?.data?.review;
      check(
        "9. 自己的计划 → 复评成功（含完成率）",
        wf2.json?.code === 0 && !!review && typeof review.completionRate === "number",
        wf2.text.slice(0, 200)
      );
      console.log(
        `       review: rate=${review?.completionRate}% changes=${(review?.changes ?? []).length} source=${review?.source}`
      );

      // 10. 别人用自己的 token 复评这条计划 → 403（用 admin token 试）
      const adminTry = await api("/health/agent/review", {
        method: "POST",
        token: adminToken,
        body: { planId: mine.id }
      });
      check(
        "10. 他人 token 复评我的计划 → 403（不泄露完成率）",
        adminTry.status === 403 || adminTry.json?.code === 403,
        { status: adminTry.status, body: adminTry.text.slice(0, 120) }
      );
    }
  }

  return token;
}

(async () => {
  const adminToken = await login(ADMIN.username, ADMIN.password);
  console.log("admin 登录成功");

  await runCase("新用户（零数据）", "e2e_new_user", "new", adminToken);
  await runCase("正常用户", "e2e_good_user", "good", adminToken);
  await runCase("高风险用户", "e2e_bad_user", "bad", adminToken);

  console.log(`\n========== 汇总: PASS ${pass} / FAIL ${fail} ==========`);
  process.exit(fail ? 1 : 0);
})();
