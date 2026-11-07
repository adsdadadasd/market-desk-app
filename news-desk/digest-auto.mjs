#!/usr/bin/env node
/**
 * news-desk/digest-auto.mjs — 沒有模型在線時的事實型收盤摘要（雲端用）
 *
 *   node digest-auto.mjs                       # 只在 HKT 04–09 之間、且當日未有正式簡報時產生
 *   node digest-auto.mjs --date=2026-11-02     # 指定美股交易日
 *   node digest-auto.mjs --force               # 忽略時間窗與既有簡報
 *   node digest-auto.mjs --dry                 # 只印出，不寫檔
 *
 * 有模型寫的 digest/<date>.md 時會自動讓路，不會覆蓋。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEWS_DIR = path.join(HERE, 'news');
const DIGEST_DIR = path.join(HERE, 'digest');
const ALERTS_DIR = path.join(HERE, 'alerts');

const args = process.argv.slice(2);
const argOf = (n) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : null;
};
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', hour12: false });
const hktDay = (d = new Date()) => dayFmt.format(d);
const hktHour = (d = new Date()) => Number(hourFmt.format(d));

const date = argOf('date') || hktDay(new Date(Date.now() - 864e5));
const official = path.join(DIGEST_DIR, `${date}.md`);
const outFile = path.join(DIGEST_DIR, `${date}-auto.md`);

// 只在美股剛收盤的時段產生（HKT 04:00–09:59），避免用半天資料寫出誤導的摘要
if (!FORCE && !argOf('date') && (hktHour() < 4 || hktHour() > 9)) {
  process.exit(0);
}
if (!FORCE && existsSync(official)) {
  console.log(`已有正式簡報 ${path.basename(official)}，跳過自動摘要`);
  process.exit(0);
}

// 交易時段：美股 09:30–16:00 ET ≈ HKT 21:30–05:00（冬令 22:30–06:00），用較寬的窗
const start = Date.parse(`${date}T12:00:00+08:00`);
const end = start + 26 * 3600e3;

function readDay(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return out;
}

const days = [date, hktDay(new Date(start + 26 * 3600e3))];
const items = [];
const seen = new Set();
for (const d of days) {
  for (const it of readDay(path.join(NEWS_DIR, `${d}.jsonl`))) {
    const t = Date.parse(it.publishedAt || it.at || '');
    if (!t || t < start || t > end) continue;
    const k = String(it.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(it);
  }
}
items.sort((a, b) => (b.score || 0) - (a.score || 0));
// 價格異動另有專區；同事件不同標題只留一條
const words = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9]{4,}/g) || []);
const overlap = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / ((a.size + b.size - i) || 1); };
const top = [];
for (const it of items) {
  if (it.kind === 'price') continue;
  const set = words(it.title);
  if (top.some(p => overlap(p.set, set) > 0.5)) continue;
  top.push({ ...it, set });
  if (top.length >= 8) break;
}

const state = (() => {
  try { return JSON.parse(readFileSync(path.join(HERE, 'state.json'), 'utf8')); } catch { return {}; }
})();
const quotes = state.lastQuotes || [];

let alertText = '';
for (const d of days) {
  const f = path.join(ALERTS_DIR, `${d}.md`);
  if (existsSync(f)) alertText += readFileSync(f, 'utf8').trim() + '\n\n';
}

const fmt = (v) => (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
const lines = [];
lines.push(`# ${date} 美股收盤 · 自動摘要`);
lines.push('');
lines.push('> 這份由程式按規則自動產生，只列事實與分數，未經模型解讀。');
lines.push('> 下次 Market Desk 對話時，會補上一份有人工判讀的版本。');
lines.push('');
lines.push('## 最受關注');
if (top.length) {
  top.forEach((it, i) => {
    const tk = (it.tickers || []).length ? `（${it.tickers.join('、')}）` : '';
    lines.push(`${i + 1}. **[${it.score}/11] ${it.title}** ${tk} — ${it.domain || ''}`);
    if (it.url) lines.push(`   ${it.url}`);
  });
} else {
  lines.push('（此時段沒有抓到新聞）');
}
lines.push('');
lines.push('## 名單收盤');
if (quotes.length) {
  lines.push('| Ticker | 收盤 | 1 日 | 5 日 |');
  lines.push('|---|---|---|---|');
  for (const q of quotes) lines.push(`| ${q.ticker} | ${q.price} | ${fmt(q.chg1d)} | ${fmt(q.chg5d)} |`);
} else {
  lines.push('（沒有報價資料）');
}
lines.push('');

const big = quotes.filter(q => Math.abs(q.chg1d) >= 5);
if (big.length) {
  lines.push('## 異動較大');
  for (const q of big) lines.push(`- **${q.ticker} ${fmt(q.chg1d)}**（現價 ${q.price}）`);
  lines.push('');
}

const alertHeads = alertText.split('\n').filter(l => l.startsWith('## ')).map(l => l.replace(/^## /, '').trim());
if (alertHeads.length) {
  const HKT = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) · (\d+)\/11 · (.*)$/;
  lines.push(`## 當日警報（${alertHeads.length} 條）`);
  for (const h of alertHeads.slice(0, 6)) {
    const m = h.match(HKT);
    lines.push(m ? `- [${m[3]}/11] ${m[2]} ${m[4]}` : `- ${h}`);
  }
  lines.push('');
}

const md = lines.join('\n');

if (DRY) {
  console.log(md);
  process.exit(0);
}

writeFileSync(outFile, md, 'utf8');
console.log(`auto digest: ${path.basename(outFile)}（${top.length} 條新聞、${quotes.length} 檔報價）`);
