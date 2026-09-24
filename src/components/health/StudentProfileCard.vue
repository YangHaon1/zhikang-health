<script setup lang="ts">
/**
 * V2.0 P0-1：学生健康画像卡片。
 * 面向大学生亚健康建模：年级/专业/作息/久坐/学习时长。
 * 独立 GET/PUT /api/health/student-profile，不影响原有健康档案。
 */
import { reactive, ref, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { getStudentProfile, updateStudentProfile } from "@/api/health";

defineOptions({ name: "StudentProfileCard" });

const saving = ref(false);
const form = reactive({
  grade: "",
  major: "",
  isOffCampus: 0 as number,
  bedtime: "",
  wakeTime: "",
  sedentaryHours: 0,
  studyHours: 0
});

const gradeOptions = ["大一", "大二", "大三", "大四", "研一", "研二", "研三"];

onMounted(async () => {
  const { code, data } = await getStudentProfile();
  if (code === 0 && data) {
    form.grade = data.grade;
    form.major = data.major;
    form.isOffCampus = data.isOffCampus;
    form.bedtime = data.bedtime;
    form.wakeTime = data.wakeTime;
    form.sedentaryHours = data.sedentaryHours;
    form.studyHours = data.studyHours;
  }
});

async function save() {
  saving.value = true;
  try {
    await updateStudentProfile({ ...form });
    ElMessage.success("学生画像已保存");
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-card shadow="never" class="student-card">
    <template #header>
      <span class="font-medium">学生健康画像</span>
      <span class="text-xs text-gray-400 ml-2"
        >作息与学习习惯，用于亚健康分析</span
      >
    </template>
    <el-form label-width="100px">
      <el-form-item label="年级">
        <el-select
          v-model="form.grade"
          placeholder="选择年级"
          style="width: 100%"
        >
          <el-option v-for="g in gradeOptions" :key="g" :label="g" :value="g" />
        </el-select>
      </el-form-item>
      <el-form-item label="专业">
        <el-input v-model="form.major" placeholder="如：计算机科学与技术" />
      </el-form-item>
      <el-form-item label="校外住宿">
        <el-radio-group v-model="form.isOffCampus">
          <el-radio :value="0">校内</el-radio>
          <el-radio :value="1">校外</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="就寝时间">
        <el-time-picker
          v-model="form.bedtime"
          arrow-control
          value-format="HH:mm"
          placeholder="如 23:30"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="起床时间">
        <el-time-picker
          v-model="form.wakeTime"
          arrow-control
          value-format="HH:mm"
          placeholder="如 07:00"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="久坐时长">
        <el-input-number
          v-model="form.sedentaryHours"
          :min="0"
          :max="24"
          :step="1"
          style="width: 100%"
        />
        <span class="text-xs text-gray-400 ml-2">小时/天</span>
      </el-form-item>
      <el-form-item label="学习时长">
        <el-input-number
          v-model="form.studyHours"
          :min="0"
          :max="24"
          :step="1"
          style="width: 100%"
        />
        <span class="text-xs text-gray-400 ml-2">小时/天</span>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save"
          >保存学生画像</el-button
        >
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.student-card {
  max-width: 640px;
  margin: 16px auto;
}
</style>
