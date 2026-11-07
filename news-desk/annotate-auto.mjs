#!/usr/bin/env node
/**
 * news-desk/annotate-auto.mjs — 用便宜的模型 API 為新聞自動寫「內容＋意義」
 *
 *   node annotate-auto.mjs --date=2026-11-04 --limit=40
 *   node annotate-auto.mjs --date=2026-11-04 --all        （整日補齊）
 *   node annotate-auto.mjs --dry                          （不呼叫 API，只看會處理幾條）
 *
 * 金鑰來源（優先順序）：
 *   1. 環境變數 DEEPSEEK_API_KEY / ANNOTATE_API_KEY
 *   2. news-desk/.secrets.json  { "apiKey": "sk-...", "baseUrl": "...", "model": "..." }
 *
 * 只有「還沒有 sum」的新聞會被處理；已寫過的不會重複花錢。
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKey, getConfig } from './apikey.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : null;
};
const DRY = args.includes('--dry');
const ALL = args.includes('--all');

const date = argOf('date') || new Date().toISOString().slice(0, 10);
const limit = ALL ? Infinity : Number(argOf('limit') || '40');

// ── 設定 ──────────────────────────────────────────────────────────────
const SECRETS = path.join(HERE, '.secrets.json');
const conf = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, 'utf8')) : {};
const API_KEY = getKey();
const BASE_URL = (process.env.ANNOTATE_BASE_URL || conf.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.ANNOTATE_MODEL || conf.model || 'deepseek-chat';
const BATCH = 12;

const target = path.join(HERE, 'news', `${date}.jsonl`);
if (!existsSync(target)) { console.error('找不到', target); process.exit(1); }

const rows = readFileSync(target, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const todo = rows.filter(x => !x.sum && x.kind !== 'price' && (x.title || '').length > 8).slice(0, limit);

console.log(`日期 ${date}：共 ${rows.length} 條，待寫 ${todo.length} 條${DRY ? '（dry）' : ''}`);
if (!todo.length) process.exit(0);
if (DRY) { console.log(todo.slice(0, 3).map(x => '- ' + x.title.slice(0, 60)).join('\n')); process.exit(0); }
if (!API_KEY) {
  console.error('沒有 API 金鑰：設定環境變數 DEEPSEEK_API_KEY，或建立 news-desk/.secrets.json');
  process.exit(2);
}

const SYSTEM = `你是財經新聞編輯，服務對象是完全不懂股票的普通人。用繁體中文（台灣用語）寫作。

對每則新聞輸出：
- sum：1–2 句說明「發生了什麼」，只寫標題與常識可支持的事實，不推測。
- why：1–2 句說明「這意味著什麼」，用生活化的話解釋對公司、行業或市場的意義。

規則：
- 不要投資建議、不要說「應該買/賣」、不要預測股價。
- 不確定的事就說不確定；不要編造數字、日期或引述。
- 每句 15–45 字，避免術語；必要時用括號補充一句解釋。
- 只輸出 JSON：{"items":[{"i":0,"sum":"...","why":"..."}]}，i 對應輸入的編號。`;

async function callBatch(batch) {
  const payload = {
    model: MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: JSON.stringify(batch.map((x, i) => ({ i, title: x.title, source: x.domain || '', tickers: x.tickers || [] }))),
      },
    ],
  };

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(txt);
  return { items: parsed.items || [], usage: j.usage || {} };
}

let done = 0, failed = 0, tokensIn = 0, tokensOut = 0;
const map = new Map();

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  let out = null;
  for (let attempt = 0; attempt < 3 && !out; attempt++) {
    try { out = await callBatch(batch); }
    catch (e) { console.error('  retry', attempt + 1, e.message); await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
  }
  if (!out) { failed += batch.length; continue; }

  tokensIn += out.usage.prompt_tokens || 0;
  tokensOut += out.usage.completion_tokens || 0;

  for (const it of out.items) {
    const src = batch[it.i];
    if (!src) continue;
    if (!it.sum || !it.why) continue;
    map.set(src.key, { sum: String(it.sum).slice(0, 300), why: String(it.why).slice(0, 300) });
  }
  done += batch.length;
  console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  await new Promise(r => setTimeout(r, 300));
}

let n = 0;
const outLines = rows.map((x) => {
  const a = map.get(x.key);
  if (a) {
    x.sum = a.sum;
    x.why = a.why;
    x.at = 'model';
    n++;
  }
  return JSON.stringify(x);
});
writeFileSync(target, outLines.join('\n') + '\n', 'utf8');

const cost = (tokensIn / 1e6) * 0.27 + (tokensOut / 1e6) * 1.1;
try {
  appendFileSync(path.join(HERE, 'usage.jsonl'), JSON.stringify({
    at: new Date().toISOString(), date, items: n, tokensIn, tokensOut, cost: Number(cost.toFixed(6)),
  }) + '\n');
} catch {}

console.log(`完成：寫入 ${n} 條（失敗 ${failed}）｜tokens in ${tokensIn} / out ${tokensOut}｜約 $${cost.toFixed(4)}`);
