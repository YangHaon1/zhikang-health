<script setup lang="ts">
/** V2.1 P1-1b：大学生健康小调研 */
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { submitSurvey } from "@/api/health";
import { message } from "@/utils/message";

defineOptions({ name: "HealthSurvey" });
const router = useRouter();
const submitting = ref(false);
const result = ref<{ label: string; score: number } | null>(null);

const form = reactive({
  sleep_hours_avg: 7,
  sleep_quality: 2,
  stay_up_freq: 1,
  study_pressure: 2,
  exam_pressure: 2,
  mood_state: 2,
  exercise_times: 3,
  exercise_min: 30,
  breakfast: 1,
  diet_regular: 1,
  sedentary_hours: 8,
  phone_hours: 5
});

const OPT = {
  sleepHours: [
    { v: 5, t: "<6 小时" },
    { v: 6.5, t: "6-7 小时" },
    { v: 8, t: ">7 小时" }
  ],
  quality: [
    { v: 1, t: "差" },
    { v: 2, t: "一般" },
    { v: 3, t: "好" }
  ],
  stayUp: [
    { v: 1, t: "0-1 天" },
    { v: 2, t: "2-3 天" },
    { v: 5, t: "4 天以上" }
  ],
  pressure: [
    { v: 1, t: "很小" },
    { v: 2, t: "一般" },
    { v: 3, t: "较大" }
  ],
  mood: [
    { v: 1, t: "低落" },
    { v: 2, t: "平稳" },
    { v: 3, t: "积极" }
  ],
  exTimes: [
    { v: 0, t: "几乎不运动" },
    { v: 2, t: "1-2 次" },
    { v: 4, t: "3 次以上" }
  ],
  exMin: [
    { v: 15, t: "15 分钟内" },
    { v: 30, t: "30 分钟" },
    { v: 60, t: "60 分钟以上" }
  ],
  breakfast: [
    { v: 0, t: "很少吃" },
    { v: 1, t: "偶尔吃" },
    { v: 2, t: "每天吃" }
  ],
  diet: [
    { v: 0, t: "不规律" },
    { v: 1, t: "一般" },
    { v: 2, t: "很规律" }
  ],
  sit: [
    { v: 4, t: "<6 小时" },
    { v: 8, t: "6-10 小时" },
    { v: 12, t: ">10 小时" }
  ],
  phone: [
    { v: 3, t: "<4 小时" },
    { v: 6, t: "4-8 小时" },
    { v: 10, t: ">8 小时" }
  ]
};

async function submit() {
  submitting.value = true;
  try {
    const { code, data } = await submitSurvey(form);
    if (code === 0 && data) {
      result.value = data;
      message("调研已提交", { type: "success" });
    }
  } finally {
    submitting.value = false;
  }
}

const LABEL_TEXT: Record<string, string> = {
  low: "低风险倾向",
  medium: "中风险倾向",
  high: "高风险倾向"
};
const LABEL_COLOR: Record<string, string> = {
  low: "#16a34a",
  medium: "#f59e0b",
  high: "#dc2626"
};
</script>

<template>
  <div class="survey-page">
    <section class="survey-hero">
      <h1>了解你的生活方式状态</h1>
      <p>
        通过睡眠、压力、运动等维度，分析你的健康习惯，为 AI 预测提供真实依据
      </p>
    </section>

    <template v-if="!result">
      <div class="survey-card">
        <h3>睡眠状态</h3>
        <div class="q">
          <span>平均睡眠</span>
          <div class="opts">
            <button
              v-for="o in OPT.sleepHours"
              :key="o.v"
              :class="['opt', { on: form.sleep_hours_avg === o.v }]"
              @click="form.sleep_hours_avg = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>睡眠质量</span>
          <div class="opts">
            <button
              v-for="o in OPT.quality"
              :key="o.v"
              :class="['opt', { on: form.sleep_quality === o.v }]"
              @click="form.sleep_quality = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>每周熬夜</span>
          <div class="opts">
            <button
              v-for="o in OPT.stayUp"
              :key="o.v"
              :class="['opt', { on: form.stay_up_freq === o.v }]"
              @click="form.stay_up_freq = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
      </div>

      <div class="survey-card">
        <h3>压力情绪</h3>
        <div class="q">
          <span>学习压力</span>
          <div class="opts">
            <button
              v-for="o in OPT.pressure"
              :key="o.v"
              :class="['opt', { on: form.study_pressure === o.v }]"
              @click="form.study_pressure = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>考试压力</span>
          <div class="opts">
            <button
              v-for="o in OPT.pressure"
              :key="o.v"
              :class="['opt', { on: form.exam_pressure === o.v }]"
              @click="form.exam_pressure = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>情绪状态</span>
          <div class="opts">
            <button
              v-for="o in OPT.mood"
              :key="o.v"
              :class="['opt', { on: form.mood_state === o.v }]"
              @click="form.mood_state = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
      </div>

      <div class="survey-card">
        <h3>运动习惯</h3>
        <div class="q">
          <span>每周运动</span>
          <div class="opts">
            <button
              v-for="o in OPT.exTimes"
              :key="o.v"
              :class="['opt', { on: form.exercise_times === o.v }]"
              @click="form.exercise_times = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>单次时长</span>
          <div class="opts">
            <button
              v-for="o in OPT.exMin"
              :key="o.v"
              :class="['opt', { on: form.exercise_min === o.v }]"
              @click="form.exercise_min = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
      </div>

      <div class="survey-card">
        <h3>饮食习惯</h3>
        <div class="q">
          <span>早餐情况</span>
          <div class="opts">
            <button
              v-for="o in OPT.breakfast"
              :key="o.v"
              :class="['opt', { on: form.breakfast === o.v }]"
              @click="form.breakfast = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>饮食规律</span>
          <div class="opts">
            <button
              v-for="o in OPT.diet"
              :key="o.v"
              :class="['opt', { on: form.diet_regular === o.v }]"
              @click="form.diet_regular = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
      </div>

      <div class="survey-card">
        <h3>生活方式</h3>
        <div class="q">
          <span>每日久坐</span>
          <div class="opts">
            <button
              v-for="o in OPT.sit"
              :key="o.v"
              :class="['opt', { on: form.sedentary_hours === o.v }]"
              @click="form.sedentary_hours = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
        <div class="q">
          <span>手机使用</span>
          <div class="opts">
            <button
              v-for="o in OPT.phone"
              :key="o.v"
              :class="['opt', { on: form.phone_hours === o.v }]"
              @click="form.phone_hours = o.v"
            >
              {{ o.t }}
            </button>
          </div>
        </div>
      </div>

      <el-button
        type="primary"
        size="large"
        round
        class="submit"
        :loading="submitting"
        @click="submit"
      >
        完成调研
      </el-button>
    </template>

    <div
      v-else
      class="result-card"
      :style="{ borderTop: `4px solid ${LABEL_COLOR[result.label]}` }"
    >
      <h2>你的生活方式风险评估</h2>
      <div class="result-label" :style="{ color: LABEL_COLOR[result.label] }">
        {{ LABEL_TEXT[result.label] }}
      </div>
      <p class="result-note">
        该结果为生活方式风险倾向，供健康管理参考，不构成医学诊断。
      </p>
      <el-button type="primary" round @click="router.push('/health/risk')">
        查看 AI 健康分析 →
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.survey-page {
  max-width: 760px;
  margin: 0 auto;
}

.survey-hero {
  padding: 28px;
  margin-bottom: 18px;
  color: #fff;
  background: linear-gradient(135deg, #0f766e, #4f46e5);
  border-radius: 20px;

  h1 {
    margin: 0 0 8px;
    font-size: 24px;
  }

  p {
    margin: 0;
    font-size: 13px;
    opacity: 0.9;
  }
}

.survey-card {
  padding: 22px 24px;
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;

  h3 {
    margin: 0 0 14px;
    font-size: 16px;
    color: #17382c;
  }
}

.q {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
  color: #4b5563;
}

.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.opt {
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  background: #f4f6f8;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  transition: all 0.15s;
}

.opt.on {
  color: #fff;
  background: #4f46e5;
  border-color: #4f46e5;
}

.submit {
  width: 100%;
  margin-bottom: 24px;
}

.result-card {
  padding: 36px 28px;
  text-align: center;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 20px;

  h2 {
    margin: 0 0 12px;
    font-size: 18px;
    color: #17382c;
  }
}

.result-label {
  font-size: 32px;
  font-weight: 800;
}

.result-note {
  margin: 12px 0 20px;
  font-size: 12px;
  color: #9ca3af;
}
</style>
