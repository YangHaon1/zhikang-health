/**
 * 动态路由表（B2 由改造前的 mock 数据原样迁移，数据结构不变）。
 * 说明：rank 取值与前端 src/router/enums.ts 保持一致，前端菜单按 rank 排序。
 */

const rank = {
  healthShowcase: 0,
  healthAiHub: 1,
  healthProfile: 2,
  healthRecords: 3,
  healthTrend: 4,
  healthPlans: 5,
  healthReport: 6,
  healthChat: 7,
  healthAuthorizations: 8,
  healthImport: 9,
  healthAnalytics: 10,
  healthAudit: 11,
  healthAiProfile: 12,
  healthRisk: 13,
  healthCompanion: 14,
  systemUser: 15
};

const healthShowcaseRouter = {
  path: "/health/showcase",
  name: "HealthShowcase",
  meta: {
    icon: "ri:presentation-line",
    title: "产品展示",
    rank: rank.healthShowcase,
    roles: ["admin", "common"]
  }
};

const healthAiHubRouter = {
  path: "/health/ai-hub",
  name: "HealthAiHub",
  meta: {
    icon: "ri:apps-2-line",
    title: "menus.healthAiHub",
    rank: rank.healthAiHub,
    roles: ["admin", "common"]
  }
};

const healthProfileRouter = {
  path: "/health/profile",
  name: "HealthProfile",
  meta: {
    icon: "ri:user-heart-line",
    title: "menus.healthProfile",
    rank: rank.healthProfile,
    roles: ["admin", "common"]
  }
};

const healthRecordsRouter = {
  path: "/health/records",
  meta: {
    icon: "ri:heart-pulse-line",
    title: "menus.healthRecords",
    rank: rank.healthRecords,
    roles: ["admin", "common"]
  },
  children: [
    {
      path: "/health/records/index",
      name: "HealthRecordInput",
      meta: {
        title: "menus.healthRecordsInput",
        roles: ["admin", "common"]
      }
    },
    {
      path: "/health/records/history",
      name: "HealthRecordHistory",
      meta: {
        title: "menus.healthRecordsHistory",
        roles: ["admin", "common"]
      }
    }
  ]
};

const healthTrendRouter = {
  path: "/health/trend",
  name: "HealthTrend",
  meta: {
    icon: "ri:line-chart-line",
    title: "menus.healthTrend",
    rank: rank.healthTrend,
    roles: ["admin", "common"]
  }
};

const healthPlansRouter = {
  path: "/health/plans",
  name: "HealthPlans",
  meta: {
    icon: "ri:calendar-check-line",
    title: "menus.healthPlans",
    rank: rank.healthPlans,
    roles: ["admin", "common"]
  }
};

const healthReportRouter = {
  path: "/health/report",
  name: "HealthReport",
  meta: {
    icon: "ri:file-chart-line",
    title: "menus.healthReport",
    rank: rank.healthReport,
    roles: ["admin", "common"]
  }
};

const healthChatRouter = {
  path: "/health/chat",
  name: "HealthChat",
  meta: {
    icon: "ri:chat-search-line",
    title: "menus.healthChat",
    rank: rank.healthChat,
    roles: ["admin", "common"]
  }
};

// C5：授权中心（用户侧：查看自己的数据被谁访问 + 共享开关，只影响自己的数据）
const healthAuthorizationsRouter = {
  path: "/health/authorizations",
  name: "HealthAuthorizations",
  meta: {
    icon: "ri:shield-user-line",
    title: "menus.healthAuthorizations",
    rank: rank.healthAuthorizations,
    roles: ["admin", "common"]
  }
};

const healthImportRouter = {
  path: "/health/import",
  name: "HealthImport",
  meta: {
    icon: "ri:file-excel-2-line",
    title: "menus.healthImport",
    rank: rank.healthImport,
    roles: ["admin"]
  }
};

// C4：群体健康看板仅管理员可见（接口侧同样 adminOnly，越权返回 403）
const healthAnalyticsRouter = {
  path: "/health/analytics",
  name: "HealthAnalytics",
  meta: {
    icon: "ri:pie-chart-line",
    title: "menus.healthAnalytics",
    rank: rank.healthAnalytics,
    roles: ["admin"]
  }
};

// C5：审计日志仅管理员可见（接口侧同样 adminOnly，越权返回 403）
const healthAuditRouter = {
  path: "/health/audit",
  name: "HealthAudit",
  meta: {
    icon: "ri:file-shield-2-line",
    title: "menus.healthAudit",
    rank: rank.healthAudit,
    roles: ["admin"]
  }
};

const systemUserRouter = {
  path: "/system/user",
  name: "SystemUser",
  component: "system/user/index",
  meta: {
    icon: "ri:admin-line",
    title: "menus.pureUser",
    rank: rank.systemUser,
    roles: ["admin"]
  }
};

const healthAiProfileRouter = {
  path: "/health/ai-profile",
  name: "HealthAiProfile",
  meta: {
    icon: "ri:sparkling-2-line",
    title: "menus.healthAiProfile",
    rank: rank.healthAiProfile,
    roles: ["admin", "common"]
  }
};

const healthRiskRouter = {
  path: "/health/risk",
  name: "HealthRisk",
  meta: {
    icon: "ri:radar-line",
    title: "menus.healthRisk",
    rank: rank.healthRisk,
    roles: ["admin", "common"]
  }
};

const healthSurveyRouter = {
  path: "/health/survey",
  name: "HealthSurvey",
  meta: {
    icon: "ri:survey-line",
    title: "健康调研",
    rank: 12,
    roles: ["admin", "common"]
  }
};

const healthCompanionRouter = {
  path: "/health/companion",
  name: "HealthCompanion",
  meta: {
    icon: "ri:robot-2-line",
    title: "menus.healthCompanion",
    rank: rank.healthCompanion,
    roles: ["admin", "common"]
  }
};

/** 全量动态路由（未按角色过滤） */
export const asyncRoutes = [
  healthShowcaseRouter,
  healthAiHubRouter,
  healthProfileRouter,
  healthRecordsRouter,
  healthTrendRouter,
  healthPlansRouter,
  healthReportRouter,
  healthChatRouter,
  healthAuthorizationsRouter,
  healthImportRouter,
  healthAnalyticsRouter,
  healthAuditRouter,
  healthAiProfileRouter,
  healthRiskRouter,
  healthSurveyRouter,
  healthCompanionRouter,
  systemUserRouter
];
