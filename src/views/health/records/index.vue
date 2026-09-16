<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "@/utils/message";
import { addHealthRecord, getHealthProfile } from "@/api/health";
import type { HealthProfile, HealthRecord } from "@/types/health";
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

const form = reactive<Omit<HealthRecord, "id">>({
  date: today(),
  remark: ""
});

const rules = {
  date: [{ required: true, message: "请选择记录日期", trigger: "change" }]
};

/** 指标字段清单（用于校验是否至少填了一项） */
const indicatorKeys: Array<keyof Omit<HealthRecord, "id" | "date" | "remark">> =
  [
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
  ];

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
      const { code } = await addHealthRecord({ ...form });
      if (code === 0) {
        message("记录已保存", { type: "success" });
        // 清空指标、保留日期，便于连续录入
        indicatorKeys.forEach(k => {
          form[k] = undefined;
        });
        form.remark = "";
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
        <div class="font-medium">指标录入</div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="120px"
        class="max-w-3xl"
      >
        <el-form-item label="记录日期" prop="date">
          <el-date-picker
            v-model="form.date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="请选择日期"
          />
        </el-form-item>

        <el-divider content-position="left">血压</el-divider>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="收缩压(mmHg)">
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
                {{ grades.systolic.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="舒张压(mmHg)">
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
                {{ grades.diastolic.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">血糖</el-divider>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="空腹(mmol/L)">
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
                {{ grades.fastingGlucose.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="餐后(mmol/L)">
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
          <el-col :span="8">
            <el-form-item label="总胆固醇">
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
                {{ grades.totalCholesterol.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="甘油三酯">
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
                {{ grades.triglyceride.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="LDL">
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
                {{ grades.ldl.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="HDL">
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
                {{ grades.hdl.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">基础</el-divider>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="心率(次/分)">
              <el-input-number
                v-model="form.heartRate"
                :min="0"
                :max="300"
                :precision="0"
                placeholder="未测可不填"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="血氧(%)">
              <el-input-number
                v-model="form.bloodOxygen"
                :min="0"
                :max="100"
                :precision="0"
                placeholder="未测可不填"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="体重(kg)">
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
                {{ grades.bmi.grade }}
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            placeholder="选填，如：服药后测量、空腹状态等"
          />
        </el-form-item>

        <el-form-item>
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
