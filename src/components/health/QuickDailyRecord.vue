<script setup lang="ts">
/**
 * M2 今日记录弹窗：提交睡眠 / 运动 / 心情 / 饮食，POST /api/health/daily（同日 UPSERT）。
 * 提交成功后 emit('saved')，由父组件刷新 /daily/today。
 */
import { reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { submitDailyRecord } from "@/api/health";
import type { DietStatus, NormalizedDaily } from "@/types/health";

defineOptions({ name: "QuickDailyRecord" });

const props = defineProps<{
  visible: boolean;
  today: NormalizedDaily | null;
}>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "saved"): void;
}>();

const form = reactive({
  sleepHours: null as number | null,
  exerciseMinutes: null as number | null,
  moodScore: null as number | null,
  dietStatus: "" as DietStatus | ""
});

// 打开时把已有今日数据回填，方便用户改一项重交
watch(
  () => props.visible,
  v => {
    if (!v || !props.today) return;
    form.sleepHours = props.today.sleepHours;
    form.exerciseMinutes = props.today.exerciseMinutes;
    form.moodScore = props.today.moodScore;
    form.dietStatus = props.today.dietStatus;
  }
);

const moods = [
  { value: 1, emoji: "😞", label: "较差" },
  { value: 2, emoji: "😐", label: "一般" },
  { value: 3, emoji: "😊", label: "很好" }
];

const dietOptions: Array<{ value: DietStatus; label: string }> = [
  { value: "good", label: "规律" },
  { value: "normal", label: "一般" },
  { value: "poor", label: "不佳" }
];

const submitting = ref(false);
async function submit() {
  submitting.value = true;
  try {
    await submitDailyRecord({ ...form });
    ElMessage.success("今日记录已保存");
    emit("saved");
    emit("update:visible", false);
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || "保存失败，请稍后重试");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="今日记录"
    width="420px"
    @update:model-value="v => emit('update:visible', v)"
  >
    <el-form label-width="80px" label-position="left">
      <el-form-item label="睡眠时长">
        <el-input-number
          v-model="form.sleepHours"
          :min="0"
          :max="24"
          :step="0.5"
          placeholder="小时"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="运动分钟">
        <el-input-number
          v-model="form.exerciseMinutes"
          :min="0"
          :max="1440"
          :step="5"
          placeholder="分钟"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="心情">
        <el-radio-group v-model="form.moodScore">
          <el-radio-button v-for="m in moods" :key="m.value" :value="m.value">
            {{ m.emoji }} {{ m.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="饮食">
        <el-radio-group v-model="form.dietStatus">
          <el-radio-button
            v-for="d in dietOptions"
            :key="d.value"
            :value="d.value"
          >
            {{ d.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit"
        >保存</el-button
      >
    </template>
  </el-dialog>
</template>
