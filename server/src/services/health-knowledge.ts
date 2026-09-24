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

function load(): KnowledgeDoc[] {
  if (cache) return cache;
  const p = path.resolve(process.cwd(), "src", "data", "health-knowledge.json");
  try {
    cache = JSON.parse(fs.readFileSync(p, "utf-8")) as KnowledgeDoc[];
  } catch {
    cache = [];
  }
  return cache!;
}

/** 简单字符/关键词命中打分（中文按子串包含）。 */
function score(doc: KnowledgeDoc, terms: string[]): number {
  let s = 0;
  for (const t of terms) {
    if (!t) continue;
    if (doc.keywords.includes(t)) s += 3;
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
