#!/usr/bin/env node
/**
 * news-desk/universe.mjs — 建立基本股票庫
 *
 * 1. 從 Nasdaq screener 抓全美上市股票清單
 * 2. 篩市值 ≥ 20 億美元
 * 3. 逐檔抓 Yahoo quoteSummary（基本面＋beta），快取 7 天
 * 4. 依參考文件的三檔風險框架評分
 *
 *   node universe.mjs                完整重建（約 3-6 分鐘）
 *   node universe.mjs --limit=50     只跑前 50 檔（測試）
 *   node universe.mjs --no-fetch     只用快取
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, '.cache', 'universe');
mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_CAP = 2e9;
const CACHE_DAYS = 7;
const args = process.argv.slice(2);
const LIMIT = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const NO_FETCH = args.includes('--no-fetch');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Yahoo 會話（crumb）──────────────────────────────────────────────────
let cookie = '';
let crumb = '';
async function ensureCrumb(force = false) {
  if (crumb && !force) return;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'user-agent': UA }, redirect: 'follow' });
  const sc = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [];
  cookie = sc.map(c => c.split(';')[0]).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': UA, cookie, accept: 'text/plain' } });
  crumb = (await r2.text()).trim();
  if (!crumb || crumb.startsWith('<')) throw new Error('crumb 取得失敗');
}

async function quoteSummary(sym) {
  await ensureCrumb();
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=financialData,defaultKeyStatistics,summaryDetail,price&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'user-agent': UA, cookie, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) { await ensureCrumb(true); throw new Error('crumb 過期'); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j?.quoteSummary?.result?.[0] || null;
}

// ── 篩選與風險評分 ─────────────────────────────────────────────────────
const SECTOR_ZH = {
  Technology: '科技', 'Health Care': '醫療保健', Finance: '金融', 'Consumer Discretionary': '非必需消費',
  'Consumer Staples': '必需消費', Energy: '能源', Industrials: '工業', 'Basic Materials': '原材料',
  'Real Estate': '房地產', Utilities: '公用事業', Telecommunications: '電訊', Miscellaneous: '其他',
};

const pick = (o, k) => (o && o[k] && typeof o[k] === 'object' ? o[k].raw : o && o[k]);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function riskOf(x) {
  const flags = [];
  let forced = false;

  if (x.px != null && x.px < 2 && (x.dv || 0) < 1e7) { flags.push('低價且成交薄弱'); forced = true; }
  if (x.beta != null && x.beta > 3) { flags.push('beta > 3'); forced = true; }

  const isFin = x.sec === '金融' || x.sec === '房地產';

  // 六個維度（0-100，越高越安全）
  const size = x.cap >= 200e9 ? 95 : x.cap >= 50e9 ? 85 : x.cap >= 10e9 ? 65 : x.cap >= 5e9 ? 45 : 25;
  const profit = x.pm == null ? null : x.pm > 0.15 ? 95 : x.pm > 0.05 ? 80 : x.pm > 0 ? 60 : 20;
  const cash = x.fcf == null ? null : x.fcf > 0 ? (x.fcf > 1e9 ? 95 : 80) : 25;
  const debt = isFin || x.d2e == null ? null : x.d2e < 0.5 ? 90 : x.d2e < 1 ? 70 : x.d2e < 2 ? 45 : 20;
  const vol = x.beta == null ? null : x.beta < 0.8 ? 95 : x.beta < 1.1 ? 80 : x.beta < 1.5 ? 55 : x.beta < 2 ? 30 : 15;
  const liq = x.dv == null ? null : x.dv > 2e8 ? 95 : x.dv > 5e7 ? 85 : x.dv > 1e7 ? 70 : x.dv > 3e6 ? 50 : 25;
  const val = x.pe == null ? null : x.pe < 0 ? 25 : x.pe < 15 ? 85 : x.pe < 30 ? 70 : x.pe < 60 ? 50 : x.pe < 100 ? 30 : 15;

  const parts = [['規模', size, 0.15], ['盈利', profit, 0.20], ['現金流', cash, 0.15], ['負債', debt, 0.10], ['波動', vol, 0.20], ['流動性', liq, 0.10], ['估值', val, 0.10]];
  const known = parts.filter(([, v]) => v != null);
  // 銀行／保險／REIT 的負債與自由現金流不適用一般標準，不計入「資料不足」
  const inapplicable = isFin ? new Set(['現金流', '負債']) : new Set();
  const missing = parts.filter(([nm, v]) => v == null && !inapplicable.has(nm)).length;

  let score = null;
  if (known.length >= 4) {
    const totalW = known.reduce((a, [, , w]) => a + w, 0);
    score = Math.round(known.reduce((a, [, v, w]) => a + v * w, 0) / totalW);
  }

  if (x.pm != null && x.pm <= 0 && x.fcf != null && x.fcf < 0 && x.cap < 10e9) { flags.push('虧損＋燒錢＋中小型'); forced = true; }
  if (!isFin && x.d2e != null && x.d2e > 3) { flags.push('負債／股本 > 3'); forced = true; }

  // ── 依《風險等級判定規則》重寫：只有 高／中／低 ──────────────────
  const highReasons = [];
  if (!isFin && x.d2e != null && x.d2e > 3) highReasons.push('負債／股本超過 3 倍');
  if (x.fcf != null && x.fcf < 0 && x.cap < 10e9) highReasons.push('現金流為負且市值偏小');
  if (x.beta != null && x.beta > 2.2) highReasons.push('波動極大（beta > 2.2）');
  if (x.px != null && x.px < 2 && (x.dv || 0) < 1e7) highReasons.push('低價且成交薄弱');
  if (x.pm != null && x.pm <= 0 && (x.fcf == null || x.fcf < 0)) highReasons.push('虧損且現金流為負');
  if (forced) highReasons.push('觸發強制高風險條件');

  const insufficient = missing >= 3;
  const lowOk =
    !insufficient &&
    x.pm != null && x.pm > 0.05 &&
    x.fcf != null && x.fcf > 0 &&
    (x.beta == null || x.beta < 1.2) &&
    (x.dv == null || x.dv > 1e7) &&
    (x.pe == null || x.pe < 60) &&
    (isFin || x.d2e == null || x.d2e < 1.5) &&
    missing === 0;

  let tier;
  if (highReasons.length) tier = 'high';
  else if (lowOk) tier = 'low';
  else tier = 'medium';

  if (insufficient) {
    tier = 'medium';
    flags.push('資料不足');
  }

  return { score, tier, flags: [...flags, ...highReasons] };
}

// ── 主流程 ────────────────────────────────────────────────────────────
console.log('1/3 抓 Nasdaq 清單…');
const sr = await fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10&offset=0&download=true', {
  headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', origin: 'https://www.nasdaq.com', referer: 'https://www.nasdaq.com/' },
  signal: AbortSignal.timeout(30000),
});
const raw = await sr.json();
const rows = raw?.data?.rows || [];
console.log('   原始', rows.length, '筆');

const list = [];
const seen = new Set();
for (const r of rows) {
  const sym = String(r.symbol || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9.-]{0,6}$/.test(sym)) continue;
  if (seen.has(sym)) continue;
  const cap = Number(String(r.marketCap || '').replace(/,/g, '')) || 0;
  if (cap < MIN_CAP) continue;
  const name = String(r.name || '').replace(/\s+/g, ' ').trim();
  if (/\b(ETF|ETN|Fund|Trust Unit|Closed End)\b/i.test(name)) continue;
  seen.add(sym);
  const px = Number(String(r.lastsale || '').replace(/[$,]/g, '')) || null;
  const vol = Number(String(r.volume || '').replace(/,/g, '')) || 0;
  list.push({ s: sym, n: name.replace(/\s+Common Stock.*$/i, '').replace(/\s+Class [A-Z].*$/i, ''), sec: SECTOR_ZH[r.sector] || r.sector || '其他', ind: r.industry || '', cap, px, vol, country: r.country || '' });
}
console.log('   市值 ≥ 20 億：', list.length, '檔');
if (LIMIT) list.length = Math.min(list.length, LIMIT);

console.log('2/3 抓基本面（有快取會跳過）…');
let done = 0, failed = 0, cached = 0;
const failedList = [];
async function worker(queue) {
  while (queue.length) {
    const it = queue.shift();
    const cf = path.join(CACHE_DIR, `${it.s.replace(/[^A-Z0-9.-]/g, '_')}.json`);
    let data = null;
    if (existsSync(cf)) {
      const age = Date.now() - statSync(cf).mtimeMs;
      if (age < CACHE_DAYS * 864e5) { data = JSON.parse(readFileSync(cf, 'utf8')); cached++; }
    }
    if (!data && !NO_FETCH) {
      for (let attempt = 0; attempt < 4 && !data; attempt++) {
        try { data = await quoteSummary(it.s); }
        catch { await sleep(800 * (attempt + 1)); }
      }
      if (data) writeFileSync(cf, JSON.stringify(data), 'utf8');
      else { failed++; failedList.push(it.s); }
      await sleep(60);
    }
    if (data) {
      const fd = data.financialData || {};
      const ks = data.defaultKeyStatistics || {};
      const sd = data.summaryDetail || {};
      const pr = data.price || {};
      it.beta = num(pick(ks, 'beta'));
      it.pe = num(pick(sd, 'trailingPE')) ?? num(pick(ks, 'trailingPE'));
      it.fpe = num(pick(sd, 'forwardPE')) ?? num(pick(ks, 'forwardPE'));
      it.pm = num(pick(fd, 'profitMargins'));
      it.om = num(pick(fd, 'operatingMargins'));
      const d2eRaw = num(pick(fd, 'debtToEquity'));
      it.d2e = d2eRaw == null ? null : d2eRaw / 100;
      it.cash = num(pick(fd, 'totalCash'));
      it.debt = num(pick(fd, 'totalDebt'));
      it.fcf = num(pick(fd, 'freeCashflow'));
      it.rev = num(pick(fd, 'totalRevenue'));
      it.y1 = num(pick(ks, '52WeekChange'));
      it.hi = num(pick(sd, 'fiftyTwoWeekHigh'));
      it.lo = num(pick(sd, 'fiftyTwoWeekLow'));
      it.div = num(pick(sd, 'dividendYield'));
      it.dv = it.px && it.vol ? Math.round(it.px * it.vol) : null;
      it.marketCapYahoo = num(pick(pr, 'marketCap')) ?? num(pick(sd, 'marketCap'));
    } else {
      it.dv = it.px && it.vol ? Math.round(it.px * it.vol) : null;
    }
    done++;
    if (done % 100 === 0) console.log(`   ${done}/${list.length}（快取 ${cached}、失敗 ${failed}）`);
  }
}
const queue = [...list];
await Promise.all(Array.from({ length: 6 }, () => worker(queue)));

console.log('3/3 評分與輸出…');
const out = [];
const dist = { low: 0, medium: 0, high: 0, na: 0 };
for (const it of list) {
  const r = riskOf(it);
  dist[r.tier]++;
  out.push({
    s: it.s, n: it.n, sec: it.sec, ind: it.ind,
    cap: it.cap, px: it.px, dv: it.dv,
    beta: it.beta, pe: it.pe, fpe: it.fpe,
    pm: it.pm, d2e: it.d2e, fcf: it.fcf,
    y1: it.y1, hi: it.hi, lo: it.lo,
    tier: r.tier, score: r.score, flags: r.flags,
  });
}
out.sort((a, b) => b.cap - a.cap);
writeFileSync(path.join(HERE, 'universe.json'), JSON.stringify(out), 'utf8');
console.log('完成：', out.length, '檔 → universe.json');
console.log('   low', dist.low, '| medium', dist.medium, '| high', dist.high, '| 未評級', dist.na);
console.log('   快取命中', cached, '失敗', failed, failedList.length ? '（例：' + failedList.slice(0, 8).join(', ') + '）' : '');
