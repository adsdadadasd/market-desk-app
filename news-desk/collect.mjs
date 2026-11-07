#!/usr/bin/env node
/**
 * news-desk/collect.mjs — 美股新聞採集 + 事件評分 + 即時推送
 * 零第三方依賴，Node 18+（內建 fetch）。
 *
 *   node collect.mjs              人類可讀報告
 *   node collect.mjs --json       機器可讀（給排程／我分析用）
 *   node collect.mjs --quiet      只在有警報時輸出
 *   node collect.mjs --no-push    不發手機通知
 *   node collect.mjs --no-quotes  跳過報價
 *   node collect.mjs --digest     不抓取，只輸出今日摘要（寫 digest 用）
 *   node collect.mjs --selftest   離線自我測試
 *
 * Exit code: 0 正常、8 有警報、2 全部來源失敗、3 設定錯誤
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendNtfy } from './notify.mjs';
import { zhAlert } from './zh.mjs';

const NTFY_TOPIC = process.env.NTFY_TOPIC || '';

async function recentPushedKeys() {
  if (!NTFY_TOPIC) return new Set();
  try {
    const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}/json?poll=1&since=12h`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return new Set();
    const text = await r.text();
    const keys = new Set();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        for (const t of m.tags || []) if (String(t).startsWith('k') && String(t).length === 9) keys.add(String(t));
      } catch {}
    }
    return keys;
  } catch {
    return new Set();
  }
}


const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIRS = {
  news: path.join(HERE, 'news'),
  alerts: path.join(HERE, 'alerts'),
  digest: path.join(HERE, 'digest'),
  cache: path.join(HERE, '.cache'),
};
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });

const CONFIG = JSON.parse(readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const WATCH = JSON.parse(readFileSync(path.join(HERE, CONFIG.watchlistFile || 'watchlist.json'), 'utf8'));
const WATCH_ITEMS = Array.isArray(WATCH) ? WATCH : WATCH.items || [];
const STATE_FILE = path.join(HERE, 'state.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HKT = 'Asia/Hong_Kong';
const SEVERITY = CONFIG.severity.map(r => ({ ...r, rx: new RegExp(r.re, 'i') }));

// ── 時間 ────────────────────────────────────────────────────────────────
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: HKT, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: HKT, hour: '2-digit', hour12: false });
const stampFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: HKT, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

const hktDay = (d = new Date()) => dayFmt.format(d);
const hktHour = (d = new Date()) => Number(hourFmt.format(d));
const hktStamp = (d = new Date()) => stampFmt.format(d).replace(',', '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 小工具 ──────────────────────────────────────────────────────────────
function decodeEntities(s = '') {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, k) => {
    if (k[0] === '#') {
      const code = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[k] ?? m;
  });
}

function stripTags(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function tagAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

const STOP = new Set(('the and for with that this from have has will are was were its his her their after before over into amid says said new set gets could would may might more than then when what who why how not but you your our out up down off about against between during under again also just now today monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december').split(/\s+/));

const hash = s => createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

function normTitle(t = '') {
  return String(t)
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, '') // 去掉 Google News 尾綴的媒體名
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(t = '') {
  const s = new Set();
  for (const w of String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []) if (!STOP.has(w)) s.add(w);
  return s;
}

function similar(a, b) {
  if (a.key === b.key) return true;
  if (a.tokens.size < 3 || b.tokens.size < 3) return false;
  let inter = 0;
  for (const t of a.tokens) if (b.tokens.has(t)) inter++;
  if (inter < 3) return false;
  return inter / (a.tokens.size + b.tokens.size - inter) >= 0.34;
}

function hostOf(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function tierOf(host) {
  if (!host) return 1;
  for (const row of CONFIG.sourceTier) {
    if (host === row.match || host.endsWith('.' + row.match)) return row.tier;
  }
  return 1;
}

function isPrimary(host) {
  return !!host && CONFIG.primaryDomains.some(d => host === d || host.endsWith('.' + d));
}

// ── 抓取 ────────────────────────────────────────────────────────────────
async function fetchText(url, { tries = 2, timeout = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'en-US,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

const googleUrl = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const yahooUrl = t => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t)}&region=US&lang=en-US`;
const secUrl = cik => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=8-K&dateb=&owner=include&count=10&output=atom`;

function parseRss(xml) {
  const out = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    out.push({
      title: firstTag(b, 'title'),
      link: firstTag(b, 'link') || firstTag(b, 'guid'),
      date: firstTag(b, 'pubDate'),
      summary: stripTags(firstTag(b, 'description')).slice(0, 400),
      sourceName: stripTags(firstTag(b, 'source')),
      sourceUrl: tagAttr(b, 'source', 'url'),
    });
  }
  return out;
}

function parseAtom(xml) {
  const out = [];
  const re = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '';
    out.push({
      title: firstTag(b, 'title'),
      link,
      date: firstTag(b, 'updated') || firstTag(b, 'published'),
      summary: stripTags(firstTag(b, 'summary')).slice(0, 400),
      sourceName: 'SEC EDGAR',
      sourceUrl: 'https://www.sec.gov',
    });
  }
  return out;
}

// ── 評分 ────────────────────────────────────────────────────────────────
function severityOf(text) {
  let breadth = 0;
  const labels = [];
  for (const rule of SEVERITY) {
    if (rule.rx.test(text)) {
      labels.push(rule.label);
      breadth = Math.max(breadth, rule.breadth);
    }
  }
  return { breadth, labels: [...new Set(labels)] };
}

function watchHits(rawText) {
  const hits = [];
  for (const w of WATCH_ITEMS) {
    let hit = false;
    if (new RegExp(`\\b${w.ticker.replace(/[.-]/g, '[-.]?')}\\b`).test(rawText)) hit = true;

    if (!hit) {
      for (const a of [w.name, ...(w.aliases || [])]) {
        if (!a) continue;
        const ascii = /^[\x20-\x7E]+$/.test(a);
        if (ascii) {
          // 英文別名要有單詞邊界、且至少 4 個字母；否則 'AIP' 會命中 'Ta-AIP-ei'
          if (a.length < 4) continue;
          const re = new RegExp('(^|[^A-Za-z0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9]|$)', 'i');
          if (re.test(rawText)) { hit = true; break; }
        } else if (a.length >= 2) {
          if (rawText.includes(a)) { hit = true; break; }
        }
      }
    }
    if (hit) hits.push(w.ticker);
  }
  return hits;
}

function scoreItem(item, now = Date.now()) {
  const text = `${item.title}. ${item.summary || ''}`;
  const sev = severityOf(text);
  const tickers = watchHits(item.title);
  const host = item.domain;
  const S = item.kind === 'filing' ? 3 : item.kind === 'price' ? 3 : tierOf(host);
  const ageH = (now - Date.parse(item.publishedAt)) / 3600e3;
  const T = ageH <= 2 ? 2 : ageH <= 8 ? 1 : 0;

  let B = sev.breadth;
  if (item.kind === 'filing') B = Math.max(B, 2);
  if (item.kind === 'price') B = Math.max(B, 2);

  let R = 0;
  if (tickers.length) R = 3;
  else if (CONFIG.sectorKeywords.some(k => text.toLowerCase().includes(k))) R = 2;
  else if (sev.breadth >= 2) R = 1;

  const reasons = [];
  if (tickers.length) reasons.push(`名單：${tickers.slice(0, 3).join('、')}`);
  if (sev.labels.length) reasons.push(sev.labels.slice(0, 2).join('／'));
  if (item.kind === 'filing') reasons.push('SEC 8-K 申報');
  if (item.kind === 'price') reasons.push(`價格異動 ${item.movePct > 0 ? '+' : ''}${item.movePct?.toFixed?.(1)}%`);
  if (T === 2) reasons.push('1 小時內');
  else if (T === 1) reasons.push('8 小時內');

  let score = S + B + R + T;

  // 市場綜述／盤前前瞻類文章降權：它們是「今天可能怎樣」，不是「已經發生什麼」
  if (/(stock market today|futures (rise|fall|mixed|higher|lower|point)|wall street (climbs|rises|falls|gains|mixed)|what to watch|preview|ahead of earnings)/i.test(item.title)) {
    score = Math.max(0, score - 2);
    reasons.push('綜述／前瞻，降權');
  }

  return { S, B, R, T, score, tickers, labels: sev.labels, reasons };
}

// ── 報價 ────────────────────────────────────────────────────────────────
async function fetchQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  const txt = await fetchText(url, { tries: 2, timeout: 12000 });
  const j = JSON.parse(txt);
  const r = j?.chart?.result?.[0];
  if (!r) return null;
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const rawCloses = r.indicators?.quote?.[0]?.close || [];

  // 用日線序列自己算「上一交易日收盤」。Yahoo 的 meta.previousClose 有時是幾日前的舊值，
  // 直接拿它會把 -0.4% 算成 -13%（2026-11-03 實際踩過）。
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof rawCloses[i] === 'number') bars.push({ t: ts[i] * 1000, c: rawCloses[i] });
  }
  if (bars.length < 2) return null;

  const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
  const lastBar = bars[bars.length - 1];
  const todayEt = etDay(Date.now());
  const prev = etDay(lastBar.t) === todayEt ? bars[bars.length - 2].c : lastBar.c;
  const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : lastBar.c;
  if (typeof price !== 'number' || !prev) return null;
  const first = bars[0].c;
  return {
    ticker,
    price: Math.round(price * 100) / 100,
    prevClose: Math.round(prev * 100) / 100,
    chg1d: Math.round((price / prev - 1) * 10000) / 100,
    chg5d: Math.round((price / first - 1) * 10000) / 100,
    currency: meta.currency || 'USD',
    ts: meta.regularMarketTime || null,
  };
}

// ── 狀態 ────────────────────────────────────────────────────────────────
function loadState() {
  const empty = { version: 1, seen: {}, alertsByDay: {}, priceAlerts: {}, pending: [], lastQuotes: [], lastRun: null };
  if (!existsSync(STATE_FILE)) return empty;
  try { return { ...empty, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { return empty; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function pruneState(state) {
  const seenMs = (CONFIG.collect.seenRetentionDays || 7) * 864e5;
  const pendMs = (CONFIG.collect.pendingRetentionDays || 3) * 864e5;
  const now = Date.now();
  for (const [k, v] of Object.entries(state.seen)) if (now - Date.parse(v) > seenMs) delete state.seen[k];
  for (const k of Object.keys(state.alertsByDay)) {
    const d = new Date(`${k}T00:00:00+08:00`).getTime();
    if (Number.isFinite(d) && now - d > 8 * 864e5) delete state.alertsByDay[k];
  }
  state.pending = (state.pending || []).filter(p => now - Date.parse(p.at) < pendMs).slice(-200);
}

// ── 摘要（寫 digest 用，不抓取）─────────────────────────────────────────
function digestData() {
  const hoursArg = process.argv.find(a => a.startsWith('--hours='));
  const hours = Math.max(4, Number(hoursArg?.split('=')[1]) || 18);
  const now = Date.now();
  const since = now - hours * 3600e3;
  const today = hktDay();
  const yesterday = hktDay(new Date(now - 864e5));
  const items = [];
  for (const day of [yesterday, today]) {
    const file = path.join(DIRS.news, `${day}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const x = JSON.parse(line);
        if (Date.parse(x.publishedAt) >= since) items.push(x);
      } catch { /* ignore */ }
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const it of items.sort((a, b) => b.score - a.score)) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    uniq.push(it);
  }
  const alertParts = [yesterday, today]
    .map(d => path.join(DIRS.alerts, `${d}.md`))
    .filter(p => existsSync(p))
    .map(p => readFileSync(p, 'utf8').trim())
    .filter(Boolean);
  const alerts = alertParts.length ? alertParts.join('\n\n') : '（無）';
  const state = loadState();

  const lines = [];
  lines.push(`# ${today} 美股 · 採集摘要（回看 ${hours} 小時，HKT ${hktStamp()}）`);
  lines.push('');
  lines.push(`今日累計 ${uniq.length} 條新聞，警報 ${(state.alertsByDay?.[today] ?? 0)} 條。`);
  lines.push('');
  lines.push('## 今日警報');
  lines.push(alerts);
  lines.push('');
  lines.push('## 高分新聞（依分數）');
  for (const it of uniq.slice(0, 25)) {
    lines.push(`- [${it.score}/11] ${it.title} — ${it.domain || it.sourceName || ''}${it.tickers?.length ? ` — ${it.tickers.join(',')}` : ''}`);
    if (it.url) lines.push(`  ${it.url}`);
  }
  lines.push('');
  lines.push('## 名單報價（上次採集）');
  for (const q of state.lastQuotes || []) {
    lines.push(`- ${q.ticker} ${q.price} USD (1d ${q.chg1d >= 0 ? '+' : ''}${q.chg1d}% / 5d ${q.chg5d >= 0 ? '+' : ''}${q.chg5d}%)`);
  }
  console.log(lines.join('\n'));
}

// ── 主流程 ──────────────────────────────────────────────────────────────
const ARGS = new Set(process.argv.slice(2));
const flag = n => ARGS.has(n);

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  appendFileSync(path.join(HERE, 'collect.log'), line + '\n');
  if (!flag('--json')) console.error(line);
}

async function buildSecFeeds() {
  const cacheFile = path.join(DIRS.cache, 'cik.json');
  let map = null;
  if (existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < 7 * 864e5) {
    try { map = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { map = null; }
  }
  if (!map) {
    const raw = JSON.parse(await fetchText('https://www.sec.gov/files/company_tickers.json'));
    map = {};
    for (const k of Object.keys(raw)) {
      const e = raw[k];
      if (e?.ticker && e?.cik_str) map[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0');
    }
    writeFileSync(cacheFile, JSON.stringify(map));
  }
  const targets = CONFIG.collect.secCoreOnly ? WATCH_ITEMS.filter(w => (w.conviction ?? 0) >= 4) : WATCH_ITEMS;
  const feeds = [];
  for (const w of targets) {
    const cik = map[w.ticker.toUpperCase()];
    if (cik) feeds.push({ kind: 'sec', id: `sec:${w.ticker}`, ticker: w.ticker, url: secUrl(cik) });
  }
  return feeds;
}

function watchQuery() {
  const names = WATCH_ITEMS.flatMap(w => [w.name, ...(w.aliases || [])]).filter(Boolean);
  const uniq = [...new Set(names)].slice(0, 18);
  return uniq.length ? `(${uniq.join(' OR ')}) when:1d` : '';
}

async function collect() {
  const started = Date.now();
  const now = new Date();
  const today = hktDay(now);
  const state = loadState();

  // 1. 組 feed
  const feeds = [];
  for (const f of CONFIG.googleNews) feeds.push({ kind: 'google', id: f.id, url: googleUrl(f.q) });
  const wq = watchQuery();
  if (wq) feeds.push({ kind: 'google', id: 'watchlist', url: googleUrl(wq) });
  if (CONFIG.collect.yahooTickerNews) {
    for (const w of WATCH_ITEMS) feeds.push({ kind: 'rss', id: `yahoo:${w.ticker}`, ticker: w.ticker, url: yahooUrl(w.ticker) });
  }
  if (CONFIG.collect.secFilings) {
    try { feeds.push(...(await buildSecFeeds())); } catch (e) { log(`SEC feed 建立失敗：${e.message}`); }
  }

  // 2. 抓
  const results = await Promise.allSettled(feeds.map(f => fetchText(f.url)));
  const errors = [];
  const items = [];

  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const r = results[i];
    if (r.status !== 'fulfilled') { errors.push(`${feed.id}: ${r.reason?.message || 'fail'}`); continue; }
    const parsed = feed.kind === 'sec' ? parseAtom(r.value) : parseRss(r.value);
    let n = 0;
    for (const p of parsed) {
      if (n >= (CONFIG.collect.maxPerFeed || 40)) break;
      const title = stripTags(p.title || '').slice(0, 300);
      if (!title) continue;
      const published = Date.parse(p.date || '') || now.getTime();
      const ageH = (now.getTime() - published) / 3600e3;
      if (ageH > (CONFIG.collect.lookbackHours || 36)) continue;
      if (ageH < -2) continue;

      const kind = feed.kind === 'sec' ? 'filing' : 'news';
      const domain = feed.kind === 'sec' ? 'sec.gov' : (hostOf(p.sourceUrl) || hostOf(p.link) || '');
      const key = kind === 'filing' ? hash(`${normTitle(title)}|${p.link}`) : hash(normTitle(title));
      if (state.seen[key]) continue;

      items.push({
        key,
        kind,
        feed: feed.id,
        title,
        summary: p.summary || '',
        url: p.link || '',
        domain,
        sourceName: p.sourceName || domain,
        publishedAt: new Date(published).toISOString(),
        tickers: [],
      });
      n++;
    }
  }

  // 3. 批內去重
  const dedup = new Map();
  for (const it of items) if (!dedup.has(it.key)) dedup.set(it.key, it);
  const fresh = [...dedup.values()];

  // 4. 報價 + 價格異動事件
  const quotes = [];
  if (CONFIG.collect.quotes && !flag('--no-quotes')) {
    const rs = await Promise.allSettled(WATCH_ITEMS.map(w => fetchQuote(w.ticker)));
    for (const r of rs) if (r.status === 'fulfilled' && r.value) quotes.push(r.value);
    // 依 beta 調整門檻：波動大的股票要更大的幅度才算異常
    const betaOf = {};
    try {
      for (const u of JSON.parse(readFileSync(new URL('./universe.json', import.meta.url), 'utf8'))) {
        betaOf[u.s] = u.beta;
      }
    } catch {}

    const priceHits = [];
    for (const q of quotes) {
      const abs = Math.abs(q.chg1d);
      const base = CONFIG.collect.priceMovePct ?? 5;
      const beta = betaOf[q.ticker];
      const min = Math.max(base + 1, beta != null && beta > 2.2 ? 9 : beta != null && beta > 1.6 ? 7.5 : base + 1);
      if (abs < min) continue;
      // 報價已超過 6 小時（收市／隔夜補跑）就不再當突發推送，留在 digest
      if (q.ts && Date.now() / 1000 - q.ts > 6 * 3600) continue;
      const prev = state.priceAlerts?.[q.ticker];
      if (prev && Date.now() - Date.parse(prev.at) < 12 * 3600e3) {
        const sameDir = Math.sign(q.chg1d) === Math.sign(prev.chg);
        // 只有同方向且更深（≥2pp）才再推；單純百分比變動（前收更新、回彈）不再騷擾
        if (sameDir && abs - Math.abs(prev.chg) < 2) continue;
      }
      priceHits.push(q);
    }

    // 一次最多 6 檔，取波動最大的，避免名單擴大後警報爆炸
    priceHits.sort((a, b) => Math.abs(b.chg1d) - Math.abs(a.chg1d));
    for (const q of priceHits.slice(0, 6)) {
      const abs = Math.abs(q.chg1d);
      fresh.push({
        key: hash(`price:${q.ticker}:${hktDay()}:${q.chg1d.toFixed(1)}`),
        kind: 'price',
        feed: 'quote',
        title: `${q.ticker} 盤中 ${q.chg1d > 0 ? '+' : ''}${q.chg1d}%（現價 ${q.price}）`,
        summary: `5 日 ${q.chg5d > 0 ? '+' : ''}${q.chg5d}%`,
        url: `https://finance.yahoo.com/quote/${q.ticker}`,
        domain: 'finance.yahoo.com',
        sourceName: 'Yahoo Finance',
        publishedAt: new Date().toISOString(),
        movePct: q.chg1d,
        tickers: [q.ticker],
      });
    }
  }

  // 5. 評分
  for (const it of fresh) {
    Object.assign(it, scoreItem(it, now.getTime()));
    it.tokens = tokensOf(`${it.title} ${it.summary || ''}`);
  }

  // 6. 跨來源確認（與今日已存 + 本批比對）
  const history = [];
  const dayFile = path.join(DIRS.news, `${today}.jsonl`);
  if (existsSync(dayFile)) {
    for (const line of readFileSync(dayFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const x = JSON.parse(line);
        history.push({ ...x, tokens: tokensOf(`${x.title} ${x.summary || ''}`) });
      } catch { /* ignore */ }
    }
  }
  const pool = [...history, ...fresh];
  for (const it of fresh) {
    if (it.kind === 'price' || it.kind === 'filing') { it.domains = 1; it.primary = true; continue; }
    const doms = new Set([it.domain].filter(Boolean));
    for (const other of pool) {
      if (other === it || other.kind === 'filing' || other.kind === 'price') continue;
      if (Math.abs(Date.parse(other.publishedAt) - Date.parse(it.publishedAt)) > 12 * 3600e3) continue;
      if (similar(it, other) && other.domain) doms.add(other.domain);
    }
    it.domains = doms.size;
    it.primary = [...doms].some(isPrimary);
  }

  // 7. 決定警報
  const cfg = CONFIG.thresholds;
  const quiet = hktHour(now) >= cfg.quietHours[0] && hktHour(now) < cfg.quietHours[1];
  let remaining = Math.max(0, (cfg.alertCapPerDay ?? 5) - (state.alertsByDay?.[today] ?? 0));
  const alerts = [];
  const candidates = [];

  for (const it of [...fresh].sort((a, b) => b.score - a.score)) {
    const confirmed = (it.domains ?? 1) >= (cfg.confirmDomains ?? 2) || it.primary;
    const onList = (it.tickers || []).length > 0;
    const systemic = it.B >= 3 && ((it.domains ?? 1) >= (cfg.confirmDomains ?? 2) || it.S >= 3);
    const eligible = it.score >= cfg.alert && it.S >= (cfg.minSourceTier ?? 2) && (onList || systemic);
    let blocked = '';
    if (eligible) {
      if (!onList && !systemic) blocked = '與名單無關且非系統性';
      else if (!confirmed) blocked = '未經跨來源確認';
      else if (it.kind === 'filing' && !it.labels.length) blocked = '申報內容未達重大';
      else if (quiet && it.score < (cfg.quietMinScore ?? 10)) blocked = '靜默時段';
      else if (remaining <= 0 && it.score < 10) blocked = '今日警報上限';
    }

    if (eligible && !blocked) {
      alerts.push(it);
      remaining--;
      if (it.kind === 'price') {
        const tk = it.tickers?.[0] || it.title.split(' ')[0];
        state.priceAlerts[tk] = { at: new Date().toISOString(), chg: it.movePct };
      }
    } else if (it.score >= (cfg.digest ?? 5)) {
      if (blocked) it.blocked = blocked;
      candidates.push(it);
    }
  }

  // 7b. 合併同一事件的多條警報（只推最高分那條，記錄其餘來源數）
  const merged = [];
  for (const a of [...alerts].sort((x, y) => y.score - x.score)) {
    const hit = merged.find(m => {
      if (m.kind !== a.kind) return false;
      if (similar(m, a)) return true;
      const shareTicker = (m.tickers || []).some(t => (a.tickers || []).includes(t));
      return shareTicker && (m.labels || []).some(l => (a.labels || []).includes(l));
    });
    if (hit) {
      hit.also = (hit.also || 0) + 1;
      hit.domains = Math.max(hit.domains || 1, a.domains || 1);
      continue;
    }
    merged.push(a);
  }
  alerts.length = 0;
  alerts.push(...merged);

  // 8. 寫檔
  for (const it of fresh) {
    const { tokens, ...rest } = it;
    void tokens;
    appendFileSync(dayFile, JSON.stringify({ ...rest, at: new Date().toISOString() }) + '\n');
    state.seen[it.key] = new Date().toISOString();
  }

  if (alerts.length) {
    const lines = alerts.map(a => [
      `## ${hktStamp()} · ${a.score}/11 · ${a.title}`,
      `- 來源：${a.domain}（${a.sourceName}）`,
      `- 確認：${a.domains ?? 1} 個來源${a.primary ? '，含一級來源' : ''}`,
      `- 名單：${(a.tickers || []).join('、') || '—'}｜類型：${(a.labels || []).join('、') || a.kind}`,
      `- 連結：${a.url}`,
      '',
    ].join('\n')).join('\n\n');
    appendFileSync(path.join(DIRS.alerts, `${today}.md`), lines);
    state.alertsByDay[today] = (state.alertsByDay[today] ?? 0) + alerts.length;
  }

  // 9. 推送：價格異動合併成一條，其餘逐條
  const pushed = [];
  if (alerts.length && !flag('--no-push')) {
    const seen = await recentPushedKeys();
    const tag = (k) => 'k' + String(k).slice(0, 8);
    const priceAlerts = alerts.filter(a => a.kind === 'price' && !seen.has(tag(a.key)));
    const rest = alerts.filter(a => a.kind !== 'price' && !seen.has(tag(a.key)));
    if (alerts.length && !priceAlerts.length && !rest.length) {
      // 另一台機器已經推過，靜靜跳過
    }

    if (priceAlerts.length) {
      const msg = [
        `📉 名單價格異動（${priceAlerts.length} 檔）`,
        priceAlerts.map(a => '· ' + a.title).join('\n'),
        '先確認有無對應消息，再決定是否行動。',
      ].join('\n');
      try {
        await sendNtfy({ title: 'Market Desk', message: msg, priority: 'high', tags: ['chart_with_downwards_trend', ...priceAlerts.map(a => tag(a.key))] });
        pushed.push(...priceAlerts.map(a => a.key));
      } catch (e) {
        errors.push(`push: ${e.message}`);
      }
    }

    for (const a of rest) {
      const zh = await zhAlert({ title: a.title, domain: a.domain, tickers: a.tickers }).catch(() => null);
      const who = a.tickers && a.tickers.length ? a.tickers.join('、') : '市場';
      const msg = [
        `🚨 ${who}${(a.labels || []).length ? '｜' + a.labels.slice(0, 2).join('、') : ''}`,
        zh ? zh.what : a.title,
        zh && zh.why ? zh.why : '',
        zh && zh.tickers && zh.tickers.length ? '可能受影響：' + zh.tickers.join('、') : '',
        a.url,
      ].filter(Boolean).join('\n');
      try {
        await sendNtfy({
          title: 'Market Desk',
          message: msg,
          priority: a.score >= 10 ? 'urgent' : 'high',
          tags: ['rotating_light', tag(a.key)],
          click: a.url,
        });
        pushed.push(a.key);
      } catch (e) {
        errors.push(`push: ${e.message}`);
      }
    }
  }

  // 10. 待 digest
  for (const c of candidates) {
    if (!state.pending.some(p => p.key === c.key)) {
      state.pending.push({ key: c.key, score: c.score, title: c.title, domain: c.domain, url: c.url, tickers: c.tickers, at: new Date().toISOString() });
    }
  }
  state.lastQuotes = quotes;
  state.lastRun = new Date().toISOString();
  pruneState(state);
  saveState(state);

  return { alerts, candidates, fresh, quotes, errors, today, started };
}

// ── 輸出 ────────────────────────────────────────────────────────────────
function report(r) {
  const quiet = flag('--quiet');
  const json = flag('--json');
  const { alerts, candidates, fresh, quotes, errors, today } = r;

  if (json) {
    const out = {
      ranAt: new Date().toISOString(),
      hkt: hktStamp(),
      today,
      newCount: fresh.length,
      alerts: alerts.map(a => ({
        score: a.score, S: a.S, B: a.B, R: a.R, T: a.T,
        title: a.title, url: a.url, domain: a.domain, tickers: a.tickers,
        labels: a.labels, reasons: a.reasons, domains: a.domains, kind: a.kind,
        publishedAt: a.publishedAt,
      })),
      candidates: candidates.slice(0, 20).map(c => ({ score: c.score, title: c.title, domain: c.domain, tickers: c.tickers, blocked: c.blocked || '', url: c.url })),
      quotes,
      errors,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (quiet && !alerts.length) return;

  const lines = [];
  lines.push(`🗞️  Market Desk · ${hktStamp()} HKT`);
  lines.push(`新增 ${fresh.length} 條｜警報 ${alerts.length}｜候選 ${candidates.length}${errors.length ? `｜失敗 ${errors.length}` : ''}`);
  lines.push('');
  for (const a of alerts) {
    lines.push(`🔴 [${a.score}/11] ${a.title}`);
    lines.push(`   ${(a.labels || []).join('／')}｜確認 ${a.domains ?? 1} 源${a.primary ? '（含一級來源）' : ''}｜${a.domain}`);
    if (a.tickers?.length) lines.push(`   名單：${a.tickers.join('、')}`);
    lines.push(`   ${a.url}`);
    lines.push('');
  }
  if (candidates.length && !quiet) {
    lines.push('📋 候選（留待收盤 digest）');
    for (const c of candidates.slice(0, 8)) {
      lines.push(`   [${c.score}] ${c.title}${c.blocked ? `（${c.blocked}）` : ''}`);
    }
    lines.push('');
  }
  if (quotes.length && !quiet) {
    lines.push('📈 名單報價');
    lines.push('   ' + quotes.map(q => `${q.ticker} ${q.chg1d >= 0 ? '+' : ''}${q.chg1d}%`).join('  '));
  }
  if (errors.length && !quiet) lines.push(`\n⚠️  ${errors.slice(0, 5).join('；')}`);
  console.log(lines.join('\n'));
}

// ── 自我測試 ────────────────────────────────────────────────────────────
function selftest() {
  const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); };

  assert(decodeEntities('A &amp; B &#39;x&#39;') === "A & B 'x'", 'decodeEntities');
  assert(stripTags('<b>Hello</b>&nbsp;world') === 'Hello world', 'stripTags');
  assert(normTitle('Nvidia beats estimates - Reuters') === 'nvidia beats estimates', 'normTitle 去尾綴');
  assert(hash('abc') === hash('abc') && hash('abc') !== hash('abd'), 'hash 穩定');

  const rss = `<rss><channel>
    <item><title><![CDATA[Fed holds rates steady - Reuters]]></title><link>https://example.com/a</link>
    <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Body</p>]]></description>
    <source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
  const parsed = parseRss(rss);
  assert(parsed.length === 1 && parsed[0].title === 'Fed holds rates steady - Reuters', 'parseRss title');
  assert(parsed[0].sourceUrl === 'https://www.reuters.com', 'parseRss source url');

  assert(tierOf('www.reuters.com') === 3 && tierOf('finance.yahoo.com') === 2 && tierOf('unknown.io') === 1, '來源分級');
  assert(isPrimary('www.sec.gov') === true, '一級來源判定');

  const sev = severityOf('Fed signals emergency rate cut as war escalates');
  assert(sev.breadth === 3 && sev.labels.includes('貨幣政策'), 'severity 廣度');

  const item = {
    kind: 'news', title: 'Nvidia cuts guidance, shares plunge', summary: '',
    domain: 'reuters.com', publishedAt: new Date().toISOString(),
  };
  const s = scoreItem(item);
  assert(s.S === 3 && s.B === 2 && s.R === 3 && s.T === 2 && s.score === 10, `scoreItem 總分（實際 ${s.score}）`);

  const now = Date.now();
  const a = { key: 'a', tokens: tokensOf('nvidia cuts guidance shares plunge on weak demand') };
  const b = { key: 'b', tokens: tokensOf('nvidia cuts guidance as shares plunge on weak demand') };
  assert(similar(a, b), 'similar 判定同事件');

  assert(hktDay(new Date('2026-11-02T15:00:00Z')) === '2026-11-02', 'HKT 日期');
  assert(hktHour(new Date('2026-11-02T15:00:00Z')) === 23, 'HKT 小時');
  void now;

  console.log('\n全部通過');
}

// ── 入口 ────────────────────────────────────────────────────────────────
(async () => {
  if (flag('--selftest')) return selftest();
  if (flag('--digest')) return digestData();
  if (!WATCH_ITEMS.length) { console.error('watchlist.json 是空的'); process.exit(3); }

  try {
    const r = await collect();
    report(r);
    process.exitCode = r.alerts.length ? 8 : 0;
  } catch (e) {
    console.error('collect 失敗：', e?.stack || e?.message || e);
    process.exitCode = 2;
  }
})();
