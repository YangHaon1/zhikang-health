/**
 * 动态路由表（由 mock/asyncRoutes.ts 原样迁移，数据结构不变）。
 * 说明：rank 取值与前端 src/router/enums.ts 保持一致，前端菜单按 rank 排序。
 */

const rank = {
  healthProfile: 1,
  healthRecords: 2,
  healthTrend: 3,
  healthReport: 4,
  healthChat: 5,
  healthImport: 6,
  systemUser: 7
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

const systemUserRouter = {
  path: "/system/user",
  name: "SystemUser",
  // 路径 /system/user 会同时匹配到 form/index.vue 与 index.vue，显式指定组件路径
  component: "system/user/index",
  meta: {
    icon: "ri:admin-line",
    title: "menus.pureUser",
    rank: rank.systemUser,
    roles: ["admin"]
  }
};

/** 全量动态路由（未按角色过滤） */
export const asyncRoutes = [
  healthProfileRouter,
  healthRecordsRouter,
  healthTrendRouter,
  healthReportRouter,
  healthChatRouter,
  healthImportRouter,
  systemUserRouter
];
