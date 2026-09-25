import {
  retrieveKnowledge,
  knowledgeStatus
} from "../../server/src/services/health-knowledge.ts";

console.log("RAG status =", knowledgeStatus());
const cases = [
  "睡眠不好怎么办",
  "我最近压力很大，考试焦虑",
  "久坐一天腰酸，有什么运动建议？",
  "血压高需要注意什么",
  "今天天气不错"
];
for (const q of cases) {
  const r = retrieveKnowledge({ query: q, topK: 3 });
  console.log(
    `[${r.found ? "命中" : "未命中"}] ${q} ->`,
    r.hits.map(h => `${h.title}(${h.score})`).join(" / ") || "-"
  );
}
const rf = retrieveKnowledge({ riskFactors: ["睡眠", "压力"], topK: 2 });
console.log("riskFactors 检索 ->", rf.found, rf.hits.map(h => h.title));
