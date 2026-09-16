// 模拟后端动态生成路由（健康管理系统最终菜单）
import { defineFakeRoute } from "vite-plugin-fake-server/client";
import {
  healthProfile,
  healthRecords,
  healthTrend,
  healthReport,
  healthChat,
  healthImport,
  systemUser
} from "@/router/enums";

/**
 * roles：页面级别权限，这里模拟二种 "admin"、"common"
 * admin：管理员角色
 * common：普通角色
 */

const healthProfileRouter = {
  path: "/health/profile",
  name: "HealthProfile",
  meta: {
    icon: "ri:user-heart-line",
    title: "menus.healthProfile",
    rank: healthProfile,
    roles: ["admin", "common"]
  }
};

const healthRecordsRouter = {
  path: "/health/records",
  meta: {
    icon: "ri:heart-pulse-line",
    title: "menus.healthRecords",
    rank: healthRecords,
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
    rank: healthTrend,
    roles: ["admin", "common"]
  }
};

const healthReportRouter = {
  path: "/health/report",
  name: "HealthReport",
  meta: {
    icon: "ri:file-chart-line",
    title: "menus.healthReport",
    rank: healthReport,
    roles: ["admin", "common"]
  }
};

const healthChatRouter = {
  path: "/health/chat",
  name: "HealthChat",
  meta: {
    icon: "ri:chat-search-line",
    title: "menus.healthChat",
    rank: healthChat,
    roles: ["admin", "common"]
  }
};

const healthImportRouter = {
  path: "/health/import",
  name: "HealthImport",
  meta: {
    icon: "ri:file-excel-2-line",
    title: "menus.healthImport",
    rank: healthImport,
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
    rank: systemUser,
    roles: ["admin"]
  }
};

export default defineFakeRoute([
  {
    url: "/get-async-routes",
    method: "get",
    response: () => {
      return {
        code: 0,
        message: "操作成功",
        data: [
          healthProfileRouter,
          healthRecordsRouter,
          healthTrendRouter,
          healthReportRouter,
          healthChatRouter,
          healthImportRouter,
          systemUserRouter
        ]
      };
    }
  }
]);
