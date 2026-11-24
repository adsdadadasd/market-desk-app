#!/usr/bin/env node
/**
 * news-desk/dayq.mjs — 取某個美股交易日的收盤價與漲跌幅
 *   node dayq.mjs 2026-11-24
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) { console.error('用法: node dayq.mjs YYYY-MM-DD'); process.exit(1); }

const W = JSON.parse(readFileSync(new URL('./watchlist.json', import.meta.url), 'utf8'));
const tickers = W.items.map(i => i.ticker);
const out = {};

for (let i = 0; i < tickers.length; i += 10) {
  const batch = tickers.slice(i, i + 10);
  const rs = await Promise.allSettled(batch.map(async (t) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${t}?range=1mo&interval=1d`, {
      headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    const res = j.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const c = res?.indicators?.quote?.[0]?.close || [];
    const days = ts.map((x, k) => ({ d: new Date(x * 1000).toISOString().slice(0, 10), c: c[k] })).filter(x => x.c != null);
    const idx = days.findIndex(x => x.d === target);
    if (idx < 1) return null;
    return { ticker: t, price: Number(days[idx].c.toFixed(2)), chg1d: Number((((days[idx].c - days[idx - 1].c) / days[idx - 1].c) * 100).toFixed(2)) };
  }));
  for (const r of rs) if (r.status === 'fulfilled' && r.value) out[r.value.ticker] = r.value;
}

writeFileSync(new URL('./.tmp-q.json', import.meta.url), JSON.stringify(out), 'utf8');
const arr = Object.values(out).sort((a, b) => a.chg1d - b.chg1d);
console.log('date', target, 'n', arr.length);
console.log('down:', arr.slice(0, 5).map(x => `${x.ticker} ${x.chg1d}%`).join(' | '));
console.log('up:', arr.slice(-5).map(x => `${x.ticker} +${x.chg1d}%`).join(' | '));
