<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "@/utils/message";
import { addHealthRecord, getHealthProfile } from "@/api/health";
import type { HealthProfile, HealthRecord } from "@/types/health";
// C6：表单标签与分级符号取自共享层唯一源码 —— 新增一个指标必然同时拿到标签与符号，
// 不会出现「有输入框没有标签」的空档（标签也是 EP 自动关联 label/for 的唯一依据）。
import {
  QUALITY_LABELS,
  RECORD_FIELD_LABELS,
  SOURCE_LABELS,
  assessQuality,
  gradeMark
} from "@/types/health";
import { useNarrowScreen } from "../composables/useNarrowScreen";
import type { IndicatorGrade } from "@shared/health-engine";
import {
  gradeSystolic,
  gradeDiastolic,
  gradeFastingGlucose,
  gradeTotalCholesterol,
  gradeTriglyceride,
  gradeLdl,
  gradeHdl,
  gradeBmi
} from "@shared/health-engine";
import type { FormInstance } from "element-plus";

defineOptions({
  name: "HealthRecordInput"
});

// 档案（用于 BMI 的身高、HDL 的性别），录入时只读一次，分级纯本地计算、不请求分析接口
const profile = ref<HealthProfile | null>(null);

/** C6：≤768px 时表单标签改为顶部对齐（120px 的右对齐标签在 375px 宽下只剩一半给控件） */
const { isNarrow } = useNarrowScreen();

onMounted(async () => {
  const { code, data } = await getHealthProfile();
  if (code === 0) profile.value = data ?? null;
});

const loading = ref(false);
const formRef = ref<FormInstance>();

/** 本地日期 yyyy-MM-dd */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 本地时刻 HH:mm:ss（C2 测量时间默认取当前时刻，比 00:00:00 更贴近真实测量） */
function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

const form = reactive<Omit<HealthRecord, "id">>({
  date: today(),
  remark: ""
});

/** C2 测量时刻（HH:mm:ss）：保存时随表单提交，服务端与日期拼成 measuredAt */
const measureTime = ref(nowTime());

/**
 * C2 实时质量判定：与后端入库前判定是**同一个共享函数**，
 * 因此这里提示「存疑 / 无效」时，保存后的库里就是同一个标记。
 */
const quality = computed(() => assessQuality(form, profile.value?.height));

const rules = {
  date: [{ required: true, message: "请选择记录日期", trigger: "change" }]
};

/**
 * 指标字段清单（用于校验是否至少填了一项）。
 * 声明成 `as const satisfies ...`：元素类型保持这 11 个**数值**键的字面量联合，
 * 既能被 ts 检查「确实是 HealthRecord 的键」，又不会把 C2 新增的字符串元数据键
 * （measuredAt / sourceType / qualityFlag / deviceName）混进来 —— 混进来会让
 * `form[k] = undefined` 的写入类型塌成 never。
 */
const indicatorKeys = [
  "systolic",
  "diastolic",
  "fastingGlucose",
  "postprandialGlucose",
  "totalCholesterol",
  "triglyceride",
  "ldl",
  "hdl",
  "heartRate",
  "bloodOxygen",
  "weight"
] as const satisfies readonly (keyof Omit<
  HealthRecord,
  "id" | "date" | "remark"
>)[];

/** 录入时实时单项分级（未填项为 null，不展示） */
const grades = computed<Record<string, IndicatorGrade | null>>(() => {
  const gender = profile.value?.gender ?? 1;
  const height = profile.value?.height;
  return {
    systolic: form.systolic != null ? gradeSystolic(form.systolic) : null,
    diastolic: form.diastolic != null ? gradeDiastolic(form.diastolic) : null,
    fastingGlucose:
      form.fastingGlucose != null
        ? gradeFastingGlucose(form.fastingGlucose)
        : null,
    totalCholesterol:
      form.totalCholesterol != null
        ? gradeTotalCholesterol(form.totalCholesterol)
        : null,
    triglyceride:
      form.triglyceride != null ? gradeTriglyceride(form.triglyceride) : null,
    ldl: form.ldl != null ? gradeLdl(form.ldl) : null,
    hdl: form.hdl != null ? gradeHdl(form.hdl, gender) : null,
    // BMI：需档案身高 + 本次体重
    bmi: height && form.weight != null ? gradeBmi(height, form.weight) : null
  };
});

/** 等级 → Element Plus tag 类型 */
function tagType(level: number): "success" | "warning" | "danger" {
  if (level === 0) return "success";
  if (level === 1) return "warning";
  return "danger";
}

async function handleSave(formEl: FormInstance | undefined) {
  if (!formEl) return;
  await formEl.validate(async valid => {
    if (!valid) return;
    const hasValue = indicatorKeys.some(
      k => form[k] !== undefined && form[k] !== null
    );
    if (!hasValue) {
      message("请至少填写一项健康指标", { type: "warning" });
      return;
    }
    loading.value = true;
    try {
      const { code } = await addHealthRecord({
        ...form,
        time: measureTime.value
      });
      if (code === 0) {
        // 保存成功时如实告知服务端最终质量标记（存疑 / 无效不会拦保存，但要说清楚）
        message(
          quality.value.flag === "good"
            ? "记录已保存"
            : `记录已保存，质量标记为「${QUALITY_LABELS[quality.value.flag]}」`,
          { type: quality.value.flag === "good" ? "success" : "warning" }
        );
        // 清空指标、保留日期，便于连续录入
        indicatorKeys.forEach(k => {
          form[k] = undefined;
        });
        form.remark = "";
        measureTime.value = nowTime();
      }
    } finally {
      loading.value = false;
    }
  });
}
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="flex-bc">
          <span class="font-medium">指标录入</span>
          <!-- C2：来源提示（本页录入的一律为手动录入，设备 / 导入来源走各自入口） -->
          <el-tooltip
            content="本页保存的记录来源为「手动录入」；设备同步与批量导入的记录在历史记录页按来源区分"
            placement="top"
          >
            <el-tag size="small" effect="plain" type="info">
              数据来源：{{ SOURCE_LABELS.manual }}
            </el-tag>
          </el-tooltip>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        :label-width="isNarrow ? 'auto' : '120px'"
        :label-position="isNarrow ? 'top' : 'right'"
        class="max-w-3xl"
      >
        <!-- C6：一个表单项只放一个控件——EP 只在「恰好一个子控件」时才把可见 label
             用 for 绑到控件上（0 个或 ≥2 个会降级成 role=group + aria-labelledby）。
             测量时刻本来与记录日期并排，现拆成独立表单项，两侧都能拿到正确的标签。 -->
        <el-form-item :label="RECORD_FIELD_LABELS.date" prop="date">
          <el-date-picker
            v-model="form.date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="请选择日期"
            class="record-picker"
          />
        </el-form-item>
        <!-- C2：测量时刻（选填，默认当前时刻，留空按当天 00:00:00 记录） -->
        <el-form-item :label="RECORD_FIELD_LABELS.time">
          <el-time-picker
            v-model="measureTime"
            arrow-control
            value-format="HH:mm:ss"
            placeholder="测量时刻（选填）"
            class="record-picker"
          />
        </el-form-item>

        <el-divider content-position="left">血压</el-divider>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.systolic">
              <el-input-number
                v-model="form.systolic"
                :min="0"
                :max="300"
                :precision="0"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.systolic"
                :type="tagType(grades.systolic.level)"
                size="small"
                class="ml-2"
                :title="grades.systolic.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.systolic.level)
                }}</span>
                {{ grades.systolic.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.diastolic">
              <el-input-number
                v-model="form.diastolic"
                :min="0"
                :max="200"
                :precision="0"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.diastolic"
                :type="tagType(grades.diastolic.level)"
                size="small"
                class="ml-2"
                :title="grades.diastolic.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.diastolic.level)
                }}</span>
                {{ grades.diastolic.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">血糖</el-divider>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.fastingGlucose">
              <el-input-number
                v-model="form.fastingGlucose"
                :min="0"
                :max="40"
                :precision="1"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.fastingGlucose"
                :type="tagType(grades.fastingGlucose.level)"
                size="small"
                class="ml-2"
                :title="grades.fastingGlucose.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.fastingGlucose.level)
                }}</span>
                {{ grades.fastingGlucose.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.postprandialGlucose">
              <el-input-number
                v-model="form.postprandialGlucose"
                :min="0"
                :max="40"
                :precision="1"
                placeholder="未测可不填"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">血脂</el-divider>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.totalCholesterol">
              <el-input-number
                v-model="form.totalCholesterol"
                :min="0"
                :max="20"
                :precision="2"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.totalCholesterol"
                :type="tagType(grades.totalCholesterol.level)"
                size="small"
                class="ml-2"
                :title="grades.totalCholesterol.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.totalCholesterol.level)
                }}</span>
                {{ grades.totalCholesterol.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.triglyceride">
              <el-input-number
                v-model="form.triglyceride"
                :min="0"
                :max="20"
                :precision="2"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.triglyceride"
                :type="tagType(grades.triglyceride.level)"
                size="small"
                class="ml-2"
                :title="grades.triglyceride.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.triglyceride.level)
                }}</span>
                {{ grades.triglyceride.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.ldl">
              <el-input-number
                v-model="form.ldl"
                :min="0"
                :max="20"
                :precision="2"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.ldl"
                :type="tagType(grades.ldl.level)"
                size="small"
                class="ml-2"
                :title="grades.ldl.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.ldl.level)
                }}</span>
                {{ grades.ldl.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.hdl">
              <el-input-number
                v-model="form.hdl"
                :min="0"
                :max="20"
                :precision="2"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.hdl"
                :type="tagType(grades.hdl.level)"
                size="small"
                class="ml-2"
                :title="grades.hdl.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.hdl.level)
                }}</span>
                {{ grades.hdl.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">基础</el-divider>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.heartRate">
              <el-input-number
                v-model="form.heartRate"
                :min="0"
                :max="300"
                :precision="0"
                placeholder="未测可不填"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.bloodOxygen">
              <el-input-number
                v-model="form.bloodOxygen"
                :min="0"
                :max="100"
                :precision="0"
                placeholder="未测可不填"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item :label="RECORD_FIELD_LABELS.weight">
              <el-input-number
                v-model="form.weight"
                :min="0"
                :max="300"
                :precision="1"
                placeholder="未测可不填"
              />
              <el-tag
                v-if="grades.bmi"
                :type="tagType(grades.bmi.level)"
                size="small"
                class="ml-2"
                :title="grades.bmi.desc"
              >
                <span aria-hidden="true">{{
                  gradeMark(grades.bmi.level)
                }}</span>
                {{ grades.bmi.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="RECORD_FIELD_LABELS.remark">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            placeholder="选填，如：服药后测量、空腹状态等"
          />
        </el-form-item>

        <!-- C2：保存前的实时质量提示（与后端入库判定同一函数，所见即所存） -->
        <el-alert
          v-if="quality.flag !== 'good'"
          :type="quality.flag === 'invalid' ? 'error' : 'warning'"
          show-icon
          :closable="false"
          class="mb-4"
          :title="`当前数值将被标记为「${QUALITY_LABELS[quality.flag]}」`"
          :description="
            quality.flag === 'invalid'
              ? `${quality.issues.map(i => i.message).join('；')}——无效数据可以保存，但不会参与趋势、报告与评分`
              : quality.issues.map(i => i.message).join('；')
          "
        />

        <el-form-item class="record-submit">
          <el-button
            type="primary"
            :loading="loading"
            @click="handleSave(formRef)"
          >
            保存记录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
/* C6 移动端适配：断点 768px，与共享层 MOBILE_BREAKPOINT 同值（CSS 无法 import 常量） */

/* 桌面：两个日期/时刻控件保持固定宽度，与原来并排时的观感一致 */
.record-picker {
  width: 220px;
  max-width: 100%;
}

@media (width <= 768px) {
  /* 窄屏：选择器与数值输入框都占满一行，不再与标签争宽度 */
  .record-picker {
    width: 100%;
  }

  :deep(.el-input-number) {
    width: 100%;
  }

  /* 顶部对齐的标签下移一点间距，触控目标之间留出手指宽度 */
  :deep(.el-form-item) {
    margin-bottom: 18px;
  }

  /* 分级标签换到数值下方，避免把输入框挤到换行（换行后高度抖动很难点） */
  :deep(.el-form-item__content) {
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .record-submit :deep(.el-button) {
    width: 100%;
    height: 40px;
  }
}
</style>
