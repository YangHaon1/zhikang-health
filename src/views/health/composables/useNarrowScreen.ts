import { onBeforeUnmount, onMounted, ref } from "vue";
import { MOBILE_BREAKPOINT } from "@/types/health";

/**
 * C6 小屏判定（健康模块共用）。
 *
 * 断点取自共享层 `MOBILE_BREAKPOINT`，与各页 CSS 里的
 * `@media (width <= 768px)` 是同一个值——CSS 无法 import 常量，所以那个字面量是它的
 * 唯一副本，本文件是 JS 侧的唯一副本，两处都由常量文档约束。
 *
 * 用 `matchMedia` 而不是 `resize` 事件：断点是「跨过某个宽度」的一次性状态变化，
 * matchMedia 只在真正跨越时回调一次，不需要每次 resize 都重新比较，也不用手动 debounce。
 *
 * 只解决**用 CSS 表达不了**的响应式（组件属性，如 `el-drawer` 的宽度、表单标签位置）；
 * 能靠 CSS 解决的一律写媒体查询，不在 JS 里算样式（避免首帧闪烁）。
 */
export function useNarrowScreen(breakpoint: number = MOBILE_BREAKPOINT) {
  const isNarrow = ref(false);
  let mql: MediaQueryList | null = null;

  const apply = (matches: boolean) => {
    isNarrow.value = matches;
  };
  const onChange = (e: MediaQueryListEvent) => apply(e.matches);

  onMounted(() => {
    mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    apply(mql.matches);
    mql.addEventListener("change", onChange);
  });

  onBeforeUnmount(() => {
    mql?.removeEventListener("change", onChange);
    mql = null;
  });

  return { isNarrow, breakpoint };
}
