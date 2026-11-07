#!/usr/bin/env node
/**
 * news-desk/stories.mjs — 用模型為股票庫每檔股票寫「公司故事」（做什麼＋最近怎麼了）
 *
 *   node stories.mjs --limit=6     試跑
 *   node stories.mjs --all         全部（約 2,100 檔，分批，可中斷續跑）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKey, getConfig } from './apikey.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const LIMIT = args.includes('--all') ? Infinity : Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);

const SECRETS = path.join(HERE, '.secrets.json');
const conf = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, 'utf8')) : {};
const KEY = getKey();
const BASE = (conf.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = conf.model || 'deepseek-chat';
if (!KEY) { console.error('缺少 API 金鑰'); process.exit(2); }

const OUT = path.join(HERE, 'stories.json');
const stories = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

const universe = JSON.parse(readFileSync(path.join(HERE, 'universe.json'), 'utf8'));
const profiles = existsSync(path.join(HERE, 'profiles.json')) ? JSON.parse(readFileSync(path.join(HERE, 'profiles.json'), 'utf8')) : {};

// 每檔取最近 3 條新聞標題當「近期」素材
const newsDir = path.join(HERE, 'news');
const newsByTicker = {};
if (existsSync(newsDir)) {
  const files = readdirSync(newsDir).filter(x => x.endsWith('.jsonl')).sort().reverse().slice(0, 3);
  for (const file of files) {
    for (const line of readFileSync(path.join(newsDir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let x;
      try { x = JSON.parse(line); } catch { continue; }
      for (const t of x.tickers || []) {
        (newsByTicker[t] = newsByTicker[t] || []).push(String(x.title || '').slice(0, 90));
      }
    }
  }
}

const todo = universe
  .filter(u => !stories[u.s])
  .map(u => {
    const p = profiles[u.s] || {};
    return {
      s: u.s,
      n: u.n,
      ind: u.ind || '',
      emp: p.e || null,
      y1: u.y1,
      tier: u.tier,
      about: (p.b || '') + (p.s ? ' ' + String(p.s).slice(0, 220) : ''),
      news: (newsByTicker[u.s] || []).slice(0, 3),
    };
  });
if (Number.isFinite(LIMIT)) todo.length = Math.min(todo.length, LIMIT);

console.log(`待寫 ${todo.length} 檔（已有 ${Object.keys(stories).length}）`);
if (!todo.length) process.exit(0);

const SYSTEM = `你是財經編輯，為完全不懂股票的讀者寫公司介紹，用繁體中文（台灣用語）。

每檔公司輸出兩段：
- bg：這家公司做什麼、靠什麼賺錢。2–3 句，60–110 字。用生活化的話，避免術語。
- rc：最近怎麼了。1–2 句，40–80 字。

嚴格規則：
- 只能使用我提供的資料。不要編造營收數字、產品名稱、事件、日期或引述。
- 如果沒有新聞素材，rc 就寫「近期沒有單一重大事件」加上我給的一年漲跌與風險評級，不要自己編故事。
- 不要投資建議、不要預測股價、不要用「值得買」這類字。
- 不確定的產業細節就用「主要從事〔產業〕相關業務」帶過。

只輸出 JSON：{"items":[{"i":0,"bg":"...","rc":"..."}]}`;

async function call(batch) {
  const payload = {
    model: MODEL,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(batch.map((x, i) => ({ i, ...x }))) },
    ],
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return { items: (JSON.parse(j.choices?.[0]?.message?.content || '{}').items) || [], usage: j.usage || {} };
}

const BATCH = 8;
let tin = 0, tout = 0, done = 0, fail = 0;

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  let out = null;
  for (let a = 0; a < 3 && !out; a++) {
    try { out = await call(batch); }
    catch (e) { console.error(' retry', a + 1, e.message); await new Promise(r => setTimeout(r, 1200 * (a + 1))); }
  }
  if (!out) { fail += batch.length; continue; }

  tin += out.usage.prompt_tokens || 0;
  tout += out.usage.completion_tokens || 0;
  for (const it of out.items) {
    const src = batch[it.i];
    if (!src || !it.bg) continue;
    stories[src.s] = { bg: String(it.bg).slice(0, 260), rc: String(it.rc || '').slice(0, 200), at: 'model' };
  }
  done += batch.length;
  if (done % 80 === 0) {
    writeFileSync(OUT, JSON.stringify(stories), 'utf8');
    console.log(` ${done}/${todo.length}`);
  }
  await new Promise(r => setTimeout(r, 200));
}

writeFileSync(OUT, JSON.stringify(stories), 'utf8');
const cost = (tin / 1e6) * 0.27 + (tout / 1e6) * 1.1;
console.log(`完成：${done} 檔（失敗 ${fail}）｜tokens ${tin}/${tout}｜約 $${cost.toFixed(3)}｜總計 ${Object.keys(stories).length}`);
