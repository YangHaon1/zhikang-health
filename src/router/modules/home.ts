import { $t } from "@/plugins/i18n";
import { home } from "@/router/enums";
const Layout = () => import("@/layout/index.vue");

export default {
  path: "/",
  name: "Home",
  component: Layout,
  redirect: "/health/dashboard",
  meta: {
    icon: "ri:dashboard-line",
    title: $t("menus.healthDashboard"),
    rank: home
  },
  children: [
    {
      path: "/health/dashboard",
      name: "HealthDashboard",
      component: () => import("@/views/health/dashboard/index.vue"),
      meta: {
        title: $t("menus.healthDashboard")
      }
    }
  ]
} satisfies RouteConfigsTable;
