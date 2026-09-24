<template>
  <div class="authorizations-page">
    <!-- 页头 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 class="text-base font-bold">授权中心</h3>
          <p class="text-sm text-gray-500 mt-1">
            这里展示你的健康数据被哪些角色 / 功能访问，以及是否参与管理端的
            脱敏群体统计。开关默认关闭，只有你自己能改。
          </p>
        </div>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </el-card>

    <el-card v-if="loading && !state" shadow="never">
      <el-skeleton :rows="5" animated />
    </el-card>
    <el-empty v-else-if="!state" description="授权信息加载失败，请稍后重试" />

    <template v-else>
      <!-- 共享开关 -->
      <el-card shadow="never" class="mb-4">
        <div class="switch-row">
          <div class="switch-copy">
            <div id="share-switch-title" class="text-base font-bold">
              允许他人查看我的健康数据
            </div>
            <div class="text-sm text-gray-500 mt-1">
              {{
                state.allowShared
                  ? "已开启：你的数据会参与管理端的脱敏群体统计"
                  : "已关闭：你的数据不参与管理端的脱敏群体统计"
              }}
            </div>
          </div>
          <!-- C6：开关没有可见文字标签时，用 aria-labelledby 指向标题，
               读屏会念出「允许他人查看我的健康数据，开关，已开启」 -->
          <div class="switch-control">
            <el-tag
              :type="state.allowShared ? 'success' : 'info'"
              effect="light"
            >
              {{ state.allowShared ? "已开启" : "已关闭" }}
            </el-tag>
            <el-switch
              v-model="draft"
              :loading="saving"
              :disabled="saving"
              aria-labelledby="share-switch-title"
              :active-text="draft ? '开启' : '关闭'"
              inline-prompt
              @change="handleToggle"
            />
          </div>
        </div>

        <el-alert
          type="info"
          show-icon
          :closable="false"
          class="mt-3"
          title="开关说明"
          :description="state.note"
        />

        <div class="text-xs text-gray-400 mt-3">
          {{
            state.configured
              ? `上次修改时间：${state.updateTime}`
              : "尚未修改过，当前为默认关闭状态"
          }}
          <span class="ml-2">
            （每次变更都会写入审计日志，管理员可追溯，但日志不含任何指标数值）
          </span>
        </div>
      </el-card>

      <!-- 访问范围只读清单 -->
      <el-card shadow="never">
        <div class="text-base font-bold mb-1">我的数据访问范围</div>
        <div class="text-sm text-gray-500 mb-3">
          以下为系统当前会读取你数据的全部场景。标识「随开关变化」的条目在关闭开关后立即失效。
        </div>

        <!-- C6：min-width 是组件属性，媒体查询管不到，窄屏下走 JS 断点收窄，
             让表格尽量在视口内排下（排不下时 el-table 自身横向滚动，页面不滚） -->
        <el-table :data="state.scopes" size="small">
          <el-table-column
            prop="actor"
            label="访问方"
            :min-width="colWidths.actor"
          />
          <el-table-column
            prop="description"
            label="用途"
            :min-width="colWidths.description"
          />
          <el-table-column label="是否受开关控制" :width="colWidths.governed">
            <template #default="{ row }">
              <el-tag
                :type="row.governedBySwitch ? 'warning' : 'info'"
                effect="plain"
                size="small"
              >
                {{ row.governedBySwitch ? "随开关变化" : "系统内部固定" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="当前状态" :width="colWidths.active">
            <template #default="{ row }">
              <el-tag
                :type="row.active ? 'success' : 'danger'"
                effect="light"
                size="small"
              >
                {{ row.active ? "生效中" : "已停止" }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <div class="text-sm/6 text-gray-500 mt-3">
          <div>
            隐私：管理端群体看板只展示脱敏聚合结果，任一分组样本不足
            {{ minSample }}
            人一律隐藏；即便开启开关，也不会出现可指认到个人的数据。
          </div>
          <div>
            隔离：健康档案、指标记录、报告与对话均按账号隔离，任何接口都不会返回他人的个体数据。
          </div>
        </div>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { getAuthorizations, updateAuthorization } from "@/api/health";
import type { AuthorizationState } from "@/types/health";
import { ANALYTICS_MIN_SAMPLE } from "@/types/health";
import { useNarrowScreen } from "../composables/useNarrowScreen";

defineOptions({
  name: "HealthAuthorizations"
});

/** 小样本阈值来自共享层唯一源码，前端不另行硬编码 */
const minSample = ANALYTICS_MIN_SAMPLE;

/** C6：≤768px 时收窄表格列，宽屏保持原值 */
const { isNarrow } = useNarrowScreen();
const colWidths = computed(() =>
  isNarrow.value
    ? { actor: 110, description: 180, governed: 104, active: 88 }
    : { actor: 180, description: 320, governed: 150, active: 110 }
);

const loading = ref(false);
const saving = ref(false);
const state = ref<AuthorizationState | null>(null);
/** 开关的本地值：请求失败时回滚，避免界面状态与服务端不一致 */
const draft = ref(false);

async function load() {
  loading.value = true;
  try {
    const { code, data } = await getAuthorizations();
    if (code === 0 && data) {
      state.value = data;
      draft.value = data.allowShared;
    } else {
      message("授权信息获取失败", { type: "error" });
    }
  } catch (error: any) {
    message(error?.response?.data?.message ?? "授权信息获取失败", {
      type: "error"
    });
  } finally {
    loading.value = false;
  }
}

/**
 * 切换共享开关：以服务端返回为准回写 `draft`（含未变化时的 `changed=false`）。
 * 未真正变化时服务端不写审计，此处也不谎报「已记录」。
 */
async function handleToggle(value: boolean | string | number) {
  const next = Boolean(value);
  saving.value = true;
  try {
    const { code, data } = await updateAuthorization({ allowShared: next });
    if (code === 0 && data) {
      state.value = data;
      draft.value = data.allowShared;
      if (data.changed) {
        message(next ? "已开启共享授权" : "已关闭共享授权", {
          type: "success"
        });
      }
    } else {
      draft.value = !next;
      message("授权变更失败", { type: "error" });
    }
  } catch (error: any) {
    draft.value = !next;
    message(error?.response?.data?.message ?? "授权变更失败", {
      type: "error"
    });
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
/* C6 移动端适配：断点 768px，与共享层 MOBILE_BREAKPOINT 同值 */

/* 开关行：桌面左右排布（说明在左、开关在右），窄屏改为上下 */
.switch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.switch-copy {
  flex: 1;
  min-width: 240px;
}

.switch-control {
  display: flex;
  flex: none;
  gap: 12px;
  align-items: center;
}

@media (width <= 768px) {
  .switch-copy {
    min-width: 0;
  }

  /* 开关本身是主要操作：窄屏下铺满整行并与状态标签分列两端，触控目标更明确 */
  .switch-control {
    justify-content: space-between;
    width: 100%;
  }
}
</style>
