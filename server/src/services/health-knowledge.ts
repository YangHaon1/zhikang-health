/**
 * V2.2 P2-1：轻量健康知识检索（RAG 第一阶段）。
 * 无外部向量库：基于关键词加权的本地检索，Top-K + 相关度阈值。
 * 后续可平滑替换为 embedding 检索，接口不变。
 */
import fs from "node:fs";
import path from "node:path";

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  content: string;
  keywords: string[];
  source: string;
  version: string;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  content: string;
  source: string;
  score: number;
}

let cache: KnowledgeDoc[] | null = null;

/**
 * 知识库文件与 health-knowledge.ts 同处一个源码树内（server/src/data/），
 * 因此用 import.meta.dirname 向上定位，而不是 process.cwd()。
 * 旧实现 path.resolve(process.cwd(), "src", "data", ...) 在「项目根目录启动」
 * （根 package.json 的 dev / dev:all）时会解析成 <root>/src/data，永久读不到文件，
 * RAG 静默降级为空（catch 吞掉异常），表现为「AI 回答从不引用知识库」。
 */
const FILE = "health-knowledge.json";
let resolvedFile = "";

/**
 * 候选路径依次为：
 *   1. server/src/data/                        —— tsx 直接跑源码（dev / start，本项目实际运行方式）
 *   2. server/dist/src/data/                   —— 若将来编译后再拷贝 data
 *   3. <cwd>/server/src/data/                  —— 从项目根目录启动（根 package.json 的 dev:all）
 */
function knowledgeFile(): string {
  if (resolvedFile) return resolvedFile;
  const here = import.meta.dirname;
  const candidates = [
    path.resolve(here, "..", "data", FILE),
    path.resolve(here, "..", "..", "src", "data", FILE),
    path.resolve(process.cwd(), "server", "src", "data", FILE)
  ];
  resolvedFile = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
  return resolvedFile;
}

function load(): KnowledgeDoc[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(
      fs.readFileSync(knowledgeFile(), "utf-8")
    ) as KnowledgeDoc[];
  } catch {
    cache = [];
  }
  return cache!;
}

/** 暴露知识库状态，供 /api/health/ml/status 等自检接口展示，便于比赛演示时确认 RAG 生效。 */
export function knowledgeStatus(): { loaded: number; path: string } {
  return { loaded: load().length, path: knowledgeFile() };
}

/** 简单字符/关键词命中打分（中文按子串包含）。 */
function score(doc: KnowledgeDoc, terms: string[]): number {
  let s = 0;
  for (const t of terms) {
    if (!t) continue;
    if (doc.keywords.includes(t)) s += 3;
    // 反向包含：用户提问是整句（"睡眠不好怎么办"），关键词是短词（"睡眠"）。
    // 只做正向相等匹配时整句永远命中不了，RAG 实际注入率≈0。
    else if (doc.keywords.some(k => k && t.includes(k))) s += 2;
    else if (doc.title.includes(t)) s += 2;
    else if (doc.content.includes(t)) s += 1;
  }
  return s;
}

/**
 * 综合 query + riskFactors + category 检索 Top-K。
 * 低于阈值返回空（不强行注入无关知识）。
 */
export function retrieveKnowledge(opts: {
  query?: string;
  riskFactors?: string[];
  categories?: string[];
  topK?: number;
}): { found: boolean; hits: KnowledgeHit[] } {
  const docs = load();
  if (!docs.length) return { found: false, hits: [] };
  const terms: string[] = [];
  if (opts.query)
    terms.push(...opts.query.split(/[\s,，。、？?！!]+/).filter(Boolean));
  if (opts.riskFactors) terms.push(...opts.riskFactors);

  const scored = docs
    .map(d => {
      let s = score(d, terms);
      // 类别加权：风险因素命中类别直接加分
      if (opts.categories?.includes(d.category)) s += 2;
      return { d, s };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.topK ?? 3);

  if (!scored.length) return { found: false, hits: [] };
  return {
    found: true,
    hits: scored.map(x => ({
      id: x.d.id,
      title: x.d.title,
      content: x.d.content,
      source: x.d.source,
      score: x.s
    }))
  };
}
