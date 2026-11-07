#!/usr/bin/env node
/**
 * news-desk/zh.mjs — 把英文新聞標題變成中文的兩句話（給手機推送用）
 * 沒有金鑰或呼叫失敗時回傳 null，呼叫端自行 fallback。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKey, getConfig } from './apikey.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const conf = existsSync(path.join(HERE, '.secrets.json'))
  ? JSON.parse(readFileSync(path.join(HERE, '.secrets.json'), 'utf8'))
  : {};
const KEY = getKey();
const BASE = (conf.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = conf.model || 'deepseek-chat';

export async function zhAlert({ title, domain, tickers }) {
  if (!KEY) return null;
  const prompt = `用繁體中文改寫這則財經新聞，給完全不懂股票的人看。

標題：${title}
來源：${domain || '未知'}
相關股票：${(tickers || []).join('、') || '無'}

輸出 JSON：{"what":"發生了什麼，一句 20-35 字","why":"這意味著什麼，一句 20-35 字","tickers":["2-5 個可能受較大影響的美股代號"]}
tickers 的要求：即使新聞本身沒有直接提到個股，也要依政策或事件方向推測 2–5 檔「可能受較大影響」的美股代號（例如選舉結果之於媒體、監獄、太陽能、國防類股）。只寫代號，不要解釋；真的想不到才留空陣列。
不要投資建議、不要預測股價、不要編造數字。`;

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}');
    if (!out.what) return null;
    return {
      what: String(out.what).slice(0, 120),
      why: String(out.why || '').slice(0, 120),
      tickers: Array.isArray(out.tickers) ? out.tickers.slice(0, 5).map(String) : [],
    };
  } catch {
    return null;
  }
}
