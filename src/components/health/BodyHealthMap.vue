<script setup lang="ts">
/**
 * 人体健康图（2D SVG MVP）
 * 驾驶舱 / 风险页共用：中央轮廓 + 热点挂指标，选中后向外抛事件。
 */
import { computed, ref, watch } from "vue";

export type BodyHotspotKey =
  "sleep" | "exercise" | "stress" | "diet" | "routine" | "risk";

export interface BodyHotspot {
  key: BodyHotspotKey;
  label: string;
  /** 0–100；null 表示暂无数据 */
  value: number | null;
  /** 展示用文案，如 "良好" / "中等风险" */
  detail?: string;
  color?: string;
}

const props = withDefaults(
  defineProps<{
    hotspots: BodyHotspot[];
    /** risk 模式会强化风险热点描边 */
    mode?: "cockpit" | "risk";
    modelValue?: BodyHotspotKey | null;
  }>(),
  {
    mode: "cockpit",
    modelValue: null
  }
);

const emit = defineEmits<{
  "update:modelValue": [BodyHotspotKey | null];
  select: [BodyHotspot];
}>();

const selected = ref<BodyHotspotKey | null>(props.modelValue);

watch(
  () => props.modelValue,
  v => {
    selected.value = v ?? null;
  }
);

const byKey = computed(() => {
  const map = new Map<string, BodyHotspot>();
  for (const h of props.hotspots) map.set(h.key, h);
  return map;
});

/** 热点在 viewBox 中的锚点（人体示意坐标） */
const ANCHORS: Record<
  BodyHotspotKey,
  { cx: number; cy: number; side: "left" | "right" | "center" }
> = {
  sleep: { cx: 160, cy: 52, side: "right" },
  stress: { cx: 160, cy: 118, side: "left" },
  exercise: { cx: 108, cy: 210, side: "left" },
  diet: { cx: 160, cy: 248, side: "right" },
  routine: { cx: 160, cy: 320, side: "left" },
  risk: { cx: 160, cy: 168, side: "right" }
};

const ordered = computed(() =>
  (Object.keys(ANCHORS) as BodyHotspotKey[])
    .map(k => byKey.value.get(k))
    .filter((h): h is BodyHotspot => !!h)
);

function pick(h: BodyHotspot) {
  selected.value = h.key;
  emit("update:modelValue", h.key);
  emit("select", h);
}

function display(h: BodyHotspot) {
  if (h.value == null) return "—";
  return String(Math.round(h.value));
}

function tone(h: BodyHotspot) {
  return h.color || "var(--hc-primary)";
}
</script>

<template>
  <div class="body-map" :class="[`body-map--${mode}`]">
    <div class="body-map__stage">
      <svg
        class="body-map__svg"
        viewBox="0 0 320 420"
        role="img"
        aria-label="人体健康指标示意"
      >
        <defs>
          <linearGradient id="bodyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgb(148 163 184 / 18%)" />
            <stop offset="100%" stop-color="rgb(100 116 139 / 8%)" />
          </linearGradient>
        </defs>

        <!-- 简化正面人体轮廓 -->
        <g
          class="body-silhouette"
          fill="url(#bodyFill)"
          stroke="var(--hc-border-strong)"
          stroke-width="1.5"
        >
          <ellipse cx="160" cy="48" rx="28" ry="34" />
          <path
            d="M118 92
               C118 78 202 78 202 92
               L214 150
               C218 168 210 178 200 182
               L196 250
               C194 278 188 300 182 330
               L176 390
               C174 400 166 404 160 404
               C154 404 146 400 144 390
               L138 330
               C132 300 126 278 124 250
               L120 182
               C110 178 102 168 106 150
               Z"
          />
          <path
            d="M106 150 C78 168 62 210 58 250 C56 268 68 276 78 268 L108 210"
            fill="url(#bodyFill)"
          />
          <path
            d="M214 150 C242 168 258 210 262 250 C264 268 252 276 242 268 L212 210"
            fill="url(#bodyFill)"
          />
        </g>

        <!-- 连接线 + 热点 -->
        <g v-for="h in ordered" :key="h.key" class="hotspot-layer">
          <line
            class="hotspot-line"
            :x1="ANCHORS[h.key].cx"
            :y1="ANCHORS[h.key].cy"
            :x2="
              ANCHORS[h.key].side === 'left'
                ? 36
                : ANCHORS[h.key].side === 'right'
                  ? 284
                  : ANCHORS[h.key].cx
            "
            :y2="ANCHORS[h.key].cy"
            :stroke="tone(h)"
          />
          <circle
            class="hotspot-dot"
            :class="{ 'is-active': selected === h.key }"
            :cx="ANCHORS[h.key].cx"
            :cy="ANCHORS[h.key].cy"
            r="7"
            :fill="tone(h)"
            role="button"
            tabindex="0"
            :aria-label="h.label"
            @click="pick(h)"
            @keydown.enter.prevent="pick(h)"
          />
        </g>
      </svg>

      <!-- HTML 浮层标签，避免 SVG 文字难排 -->
      <button
        v-for="h in ordered"
        :key="`chip-${h.key}`"
        type="button"
        class="hotspot-chip"
        :class="[
          `hotspot-chip--${ANCHORS[h.key].side}`,
          { 'is-active': selected === h.key }
        ]"
        :style="{
          top: `${(ANCHORS[h.key].cy / 420) * 100}%`,
          '--chip-accent': tone(h)
        }"
        @click="pick(h)"
      >
        <span class="hotspot-chip__label">{{ h.label }}</span>
        <span class="hotspot-chip__value hc-num">{{ display(h) }}</span>
        <span v-if="h.detail" class="hotspot-chip__detail">{{ h.detail }}</span>
      </button>
    </div>

    <aside v-if="selected && byKey.get(selected)" class="body-map__panel">
      <p class="panel-kicker">
        {{ mode === "risk" ? "风险焦点" : "指标详情" }}
      </p>
      <h3>{{ byKey.get(selected)!.label }}</h3>
      <p
        class="panel-score hc-num"
        :style="{ color: tone(byKey.get(selected)!) }"
      >
        {{ display(byKey.get(selected)!) }}
        <span v-if="byKey.get(selected)!.value != null">分</span>
      </p>
      <p v-if="byKey.get(selected)!.detail" class="panel-detail">
        {{ byKey.get(selected)!.detail }}
      </p>
      <p v-else class="panel-detail">暂无更多说明，可继续完善今日记录。</p>
    </aside>
  </div>
</template>

<style scoped lang="scss">
.body-map {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(200px, 0.8fr);
  gap: 20px;
  align-items: stretch;
  padding: 20px;
  background: var(--hc-card, rgb(148 184 255 / 4%));
  border: 1px solid var(--hc-border, rgb(148 184 255 / 12%));
  border-radius: 20px;
  backdrop-filter: blur(16px);
}

.body-map__stage {
  position: relative;
  min-height: 360px;
}

.body-map__svg {
  display: block;
  width: 100%;
  max-width: 360px;
  height: auto;
  margin: 0 auto;
}

.body-silhouette {
  transition: opacity var(--hc-motion-duration, 240ms)
    var(--hc-motion-ease, ease);
}

.hotspot-line {
  stroke-opacity: 0.35;
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.hotspot-dot {
  cursor: pointer;
  stroke: rgb(255 255 255 / 35%);
  stroke-width: 1.5;
  transform-origin: center;
  transform-box: fill-box;
  transition:
    transform var(--hc-motion-duration, 200ms) var(--hc-motion-ease, ease),
    opacity var(--hc-motion-duration, 200ms) var(--hc-motion-ease, ease);

  &:hover,
  &.is-active {
    transform: scale(1.35);
  }
}

.hotspot-chip {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 88px;
  padding: 8px 10px;
  color: var(--hc-text-primary, #e6edf7);
  text-align: left;
  cursor: pointer;
  background: var(--hc-bg-raise, #0a1120);
  border: 1px solid var(--hc-border, rgb(148 184 255 / 12%));
  border-radius: 12px;
  transform: translateY(-50%);
  transition:
    border-color var(--hc-motion-duration, 200ms) var(--hc-motion-ease, ease),
    transform var(--hc-motion-duration, 200ms) var(--hc-motion-ease, ease),
    background var(--hc-motion-duration, 200ms) var(--hc-motion-ease, ease);

  &--left {
    left: 0;
  }

  &--right {
    right: 0;
  }

  &--center {
    left: 50%;
    transform: translate(-50%, -50%);
  }

  &.is-active {
    border-color: var(--chip-accent, var(--hc-primary));
    box-shadow: 0 0 0 1px
      color-mix(in srgb, var(--chip-accent) 35%, transparent);
    transform: translateY(calc(-50% - 2px));
  }

  &--center.is-active {
    transform: translate(-50%, calc(-50% - 2px));
  }
}

.hotspot-chip__label {
  font-size: 11px;
  color: var(--hc-text-secondary, #9aa8bf);
}

.hotspot-chip__value {
  font-size: 18px;
  font-weight: 650;
  line-height: 1.1;
  color: var(--chip-accent, var(--hc-primary));
}

.hotspot-chip__detail {
  font-size: 11px;
  color: var(--hc-text-secondary, #9aa8bf);
}

.body-map__panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8px 4px 8px 8px;
  border-left: 1px solid var(--hc-border, rgb(148 184 255 / 12%));
}

.panel-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--hc-text-secondary, #9aa8bf);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.body-map__panel h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--hc-text-primary, #e6edf7);
}

.panel-score {
  margin: 10px 0 6px;
  font-size: 36px;
  font-weight: 650;
  line-height: 1;

  span {
    margin-left: 4px;
    font-size: 14px;
    font-weight: 500;
    color: var(--hc-text-secondary, #9aa8bf);
  }
}

.panel-detail {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--hc-text-secondary, #9aa8bf);
}

@media (width <= 900px) {
  .body-map {
    grid-template-columns: 1fr;
  }

  .body-map__panel {
    padding-top: 16px;
    border-top: 1px solid var(--hc-border, rgb(148 184 255 / 12%));
    border-left: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hotspot-dot,
  .hotspot-chip,
  .body-silhouette {
    transition: none !important;
  }
}
</style>
