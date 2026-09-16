<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { message } from "@/utils/message";
import { getHealthProfile, updateHealthProfile } from "@/api/health";
import type { HealthProfile } from "@/types/health";
import type { FormInstance } from "element-plus";

defineOptions({
  name: "HealthProfile"
});

const loading = ref(false);
const formRef = ref<FormInstance>();

const form = reactive<HealthProfile>({
  name: "",
  gender: 1,
  age: 0,
  height: 0,
  weight: 0,
  waistline: 0,
  medicalHistory: "",
  familyHistory: "",
  allergyHistory: "",
  smoking: "",
  drinking: "",
  exercise: "",
  createTime: ""
});

const rules = {
  name: [{ required: true, message: "请输入姓名", trigger: "blur" }],
  age: [{ required: true, message: "请输入年龄", trigger: "blur" }]
};

async function loadProfile() {
  const { code, data } = await getHealthProfile();
  if (code === 0 && data) Object.assign(form, data);
}

async function handleSave(formEl: FormInstance | undefined) {
  if (!formEl) return;
  await formEl.validate(async valid => {
    if (!valid) return;
    loading.value = true;
    try {
      const { code } = await updateHealthProfile({ ...form });
      if (code === 0) message("档案已保存", { type: "success" });
    } finally {
      loading.value = false;
    }
  });
}

onMounted(() => {
  loadProfile();
});
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="font-medium">健康档案</div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        class="max-w-3xl"
      >
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" placeholder="请输入姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="性别">
              <el-radio-group v-model="form.gender">
                <el-radio :value="1">男</el-radio>
                <el-radio :value="0">女</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="年龄" prop="age">
              <el-input-number v-model="form.age" :min="0" :max="150" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="身高(cm)">
              <el-input-number v-model="form.height" :min="0" :max="250" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="体重(kg)">
              <el-input-number v-model="form.weight" :min="0" :max="300" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="腰围(cm)">
              <el-input-number v-model="form.waistline" :min="0" :max="200" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="既往病史">
          <el-input
            v-model="form.medicalHistory"
            type="textarea"
            :rows="2"
            placeholder="如：高血压、糖尿病等，无则填无"
          />
        </el-form-item>
        <el-form-item label="家族史">
          <el-input
            v-model="form.familyHistory"
            type="textarea"
            :rows="2"
            placeholder="直系亲属重大疾病史，无则填无"
          />
        </el-form-item>
        <el-form-item label="过敏史">
          <el-input
            v-model="form.allergyHistory"
            type="textarea"
            :rows="2"
            placeholder="药物 / 食物过敏史，无则填无"
          />
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="吸烟">
              <el-select v-model="form.smoking" placeholder="请选择" clearable>
                <el-option label="从不" value="从不" />
                <el-option label="偶尔" value="偶尔" />
                <el-option label="经常" value="经常" />
                <el-option label="已戒烟" value="已戒烟" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="饮酒">
              <el-select v-model="form.drinking" placeholder="请选择" clearable>
                <el-option label="从不" value="从不" />
                <el-option label="偶尔" value="偶尔" />
                <el-option label="经常" value="经常" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="运动频率">
              <el-select v-model="form.exercise" placeholder="请选择" clearable>
                <el-option label="几乎不运动" value="几乎不运动" />
                <el-option label="每周1-2次" value="每周1-2次" />
                <el-option label="每周3-5次" value="每周3-5次" />
                <el-option label="每周6次以上" value="每周6次以上" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            @click="handleSave(formRef)"
          >
            保存档案
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>
