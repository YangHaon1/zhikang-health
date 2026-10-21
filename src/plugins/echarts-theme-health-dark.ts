import * as echarts from "echarts/core";

/**
 * 智康健康管理系统 — ECharts 深色驾驶舱主题
 *
 * 在 echarts.ts 加载后调用一次 registerHealthDarkTheme()。
 * 页面里：echarts.init(el, isDark.value ? "health-dark" : undefined)
 */
export function registerHealthDarkTheme() {
  echarts.registerTheme("health-dark", {
    backgroundColor: "transparent",
    textStyle: { color: "#9aa8bf", fontFamily: "inherit" },
    title: { textStyle: { color: "#e6edf7", fontWeight: 600 } },
    legend: { textStyle: { color: "#9aa8bf" }, inactiveColor: "#5b6b85" },
    grid: { borderColor: "transparent" },
    categoryAxis: {
      axisLine: { lineStyle: { color: "rgba(148,184,255,0.2)" } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: "#9aa8bf" }
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: { color: "rgba(148,184,255,0.08)", type: "dashed" }
      },
      axisLabel: { color: "#9aa8bf" }
    },
    tooltip: {
      backgroundColor: "rgba(10,17,32,0.92)",
      borderColor: "rgba(148,184,255,0.25)",
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: "#e6edf7", fontSize: 12 },
      extraCssText:
        "backdrop-filter: blur(8px); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);"
    },
    line: {
      lineStyle: { width: 2, color: "#22d3ee" },
      itemStyle: { borderColor: "#22d3ee", borderWidth: 2 },
      symbol: "circle",
      symbolSize: 6
    },
    bar: {
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        borderColor: "transparent"
      }
    },
    color: ["#22d3ee", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#fb923c"]
  });
}
