#!/usr/bin/env node
/**
 * news-desk/terms.mjs — 每週從新聞找出「詞庫還沒收錄」的財經詞，產生待審候選
 *   node terms.mjs --limit=40
 * 輸出 news-desk/glossary-candidates.json（不自動寫入詞庫）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKey, getConfig } from './apikey.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const conf = existsSync(path.join(HERE, '.secrets.json')) ? JSON.parse(readFileSync(path.join(HERE, '.secrets.json'), 'utf8')) : {};
const KEY = getKey();
const BASE = (conf.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = conf.model || 'deepseek-chat';
if (!KEY) { console.error('缺少 API 金鑰'); process.exit(2); }

const glossary = JSON.parse(readFileSync(path.join(HERE, 'glossary.json'), 'utf8'));
const known = new Set(glossary.flatMap(g => [g.term, ...(g.aliases || [])]).map(x => x.toLowerCase()));

// 取最近 3 天的高分新聞標題
const newsDir = path.join(HERE, 'news');
const files = readdirSync(newsDir).filter(f => f.endsWith('.jsonl')).sort().reverse().slice(0, 3);
const titles = [];
for (const f of files) {
  for (const line of readFileSync(path.join(newsDir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const x = JSON.parse(line);
      if ((x.score || 0) >= 6 && x.title) titles.push(x.title.slice(0, 90));
    } catch {}
  }
}
const sample = titles.slice(0, 60);

const prompt = `你是財經編輯。以下是最近的新聞標題與現有詞庫已收錄的詞（不要重複）。

現有詞：${[...known].slice(0, 200).join('、')}

新聞標題：
${sample.map(t => '- ' + t).join('\n')}

請挑出 8 個「一般讀者看不懂、但新聞常出現、而詞庫還沒收錄」的財經詞。

輸出 JSON：{"items":[{"term":"詞","aliases":["英文或別名"],"cat":"估值|財務|事件|宏觀|名單機制","plain":"人話 1-2 句","pro":"專業定義 1 句"}]}
規則：只收財經／投資相關的詞；不要收公司名、股票代號；plain 要生活化、不要術語。`;

const res = await fetch(`${BASE}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: MODEL, temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  }),
  signal: AbortSignal.timeout(90000),
});
if (!res.ok) { console.error('HTTP', res.status, (await res.text()).slice(0, 200)); process.exit(1); }
const j = await res.json();
const out = JSON.parse(j.choices?.[0]?.message?.content || '{}');
const items = (out.items || []).filter(x => x.term && x.plain && !known.has(String(x.term).toLowerCase()));

writeFileSync(path.join(HERE, 'glossary-candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2), 'utf8');
console.log('candidates:', items.map(x => x.term).join('、'));
console.log('tokens', j.usage?.prompt_tokens, '/', j.usage?.completion_tokens);
