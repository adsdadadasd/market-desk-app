#!/usr/bin/env node
/**
 * news-desk/etfs.mjs — ETF 清單（AUM ≥ 10 億）＋前十大持倉
 *
 *   node etfs.mjs              完整重建（約 5-10 分鐘，之後 7 天快取）
 *   node etfs.mjs --limit=20   測試
 *   node etfs.mjs --no-fetch   只用快取重算
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache', 'etf');
mkdirSync(CACHE, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_AUM = 1e9;
const CACHE_DAYS = 7;
const args = process.argv.slice(2);
const LIMIT = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const NO_FETCH = args.includes('--no-fetch');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cookie = '', crumb = '';
async function ensureCrumb(force = false) {
  if (crumb && !force) return;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'user-agent': UA }, redirect: 'follow' });
  cookie = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  crumb = (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': UA, cookie } }).then(r => r.text())).trim();
  if (!crumb || crumb.startsWith('<')) throw new Error('crumb 失敗');
}

// 1) 清單
console.log('1/3 抓 ETF 清單…');
const sr = await fetch('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10&offset=0&download=true', {
  headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', origin: 'https://www.nasdaq.com', referer: 'https://www.nasdaq.com/' },
  signal: AbortSignal.timeout(30000),
});
const sjson = await sr.json();
const rows = sjson?.data?.data?.rows || [];
const seen = new Set();
const list = [];
for (const r of rows) {
  const sym = String(r.symbol || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(sym) || seen.has(sym)) continue;
  seen.add(sym);
  list.push({ s: sym, n: String(r.companyName || '').trim() });
}
console.log('   ETF', list.length, '檔');
if (LIMIT) list.length = Math.min(list.length, LIMIT);

// 2) AUM + 持倉（一次請求拿兩個模組）
console.log('2/3 抓規模與前十大持倉…');
const universe = JSON.parse(readFileSync(path.join(HERE, 'universe.json'), 'utf8'));
const uniSet = new Set(universe.map(x => x.s));
let done = 0, failed = 0, cached = 0;
const out = [];

async function worker(queue) {
  while (queue.length) {
    const etf = queue.shift();
    const cf = path.join(CACHE, `${etf.s}.json`);
    let data = null;
    if (existsSync(cf)) {
      const age = Date.now() - statSync(cf).mtimeMs;
      if (age < CACHE_DAYS * 864e5) { data = JSON.parse(readFileSync(cf, 'utf8')); cached++; }
    }
    if (!data && !NO_FETCH) {
      for (let attempt = 0; attempt < 3 && !data; attempt++) {
        try {
          await ensureCrumb();
          const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${etf.s}?modules=summaryDetail,topHoldings&crumb=${encodeURIComponent(crumb)}`;
          const r = await fetch(url, { headers: { 'user-agent': UA, cookie }, signal: AbortSignal.timeout(15000) });
          if (r.status === 401) { await ensureCrumb(true); throw new Error('crumb'); }
          if (r.status === 404) { data = { aum: 0, h: [] }; break; }
          const j = await r.json();
          const res = j?.quoteSummary?.result?.[0];
          if (!res) throw new Error('no result');
          const aum = res.summaryDetail?.totalAssets?.raw || 0;
          const holdings = (res.topHoldings?.holdings || [])
            .map(h => ({ t: String(h.symbol || '').toUpperCase(), w: h.holdingPercent?.raw ?? null }))
            .filter(h => h.t && uniSet.has(h.t));
          data = { aum, h: holdings };
        } catch { await sleep(500); }
      }
      if (data) writeFileSync(cf, JSON.stringify(data), 'utf8');
      else { failed++; data = { aum: 0, h: [] }; }
      await sleep(55);
    }
    if (data && data.aum >= MIN_AUM && data.h.length) {
      out.push({ s: etf.s, n: etf.n, aum: Math.round(data.aum), h: data.h });
    }
    done++;
    if (done % 250 === 0) console.log(`   ${done}/${list.length}（合格 ${out.length}、快取 ${cached}、失敗 ${failed}）`);
  }
}

const queue = [...list];
await Promise.all(Array.from({ length: 6 }, () => worker(queue)));

out.sort((a, b) => b.aum - a.aum);
writeFileSync(path.join(HERE, 'etfs.json'), JSON.stringify(out), 'utf8');
console.log('3/3 完成：', out.length, '檔 ETF（AUM ≥ 10 億且持有名單股票）→ etfs.json');
console.log('   快取', cached, '失敗', failed);
