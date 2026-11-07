#!/usr/bin/env node
/**
 * news-desk/build-site.mjs — 把 news/、digest/、alerts/、watchlist.json 組成一個離線網站
 *   node build-site.mjs           重建 site/index.html
 *   node build-site.mjs --quiet   安靜模式（排程用）
 *
 * 輸出是單一 HTML，資料內嵌，雙擊即可開，不需要伺服器或網絡。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEWS_DIR = path.join(HERE, 'news');
const DIGEST_DIR = path.join(HERE, 'digest');
const ALERTS_DIR = path.join(HERE, 'alerts');
const SITE_DIR = path.join(HERE, 'site');

const KEEP_DAYS = 14;
const PER_DAY = Infinity;

const readJson = (p, fallback) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};

const watch = readJson(path.join(HERE, 'watchlist.json'), { items: [] });
const stocks = (Array.isArray(watch) ? watch : watch.items || []).slice();

const state = readJson(path.join(HERE, 'state.json'), {});

// 股票庫（用公司名替新聞加代號標記，讓非名單股票也有歷史消息）
const UNIVERSE_FILE = path.join(HERE, 'universe.json');
const UNIVERSE_LIST = existsSync(UNIVERSE_FILE) ? JSON.parse(readFileSync(UNIVERSE_FILE, 'utf8')) : [];
const UNI_BY_TICKER = new Map(UNIVERSE_LIST.map(u => [u.s, u]));
const SECTOR_ZH_TO_PATH = {
  '科技': '科技', '醫療保健': '醫療保健', '金融': '金融', '非必需消費': '消費',
  '必需消費': '消費', '能源': '能源', '工業': '工業', '原材料': '原材料',
  '房地產': '房地產', '公用事業': '公用事業', '電訊': '通訊服務', '其他': '其他',
};
const NAME_TO_TICKER = new Map();
const GENERIC = new Set(['american', 'general', 'united', 'national', 'first', 'global', 'capital', 'international', 'standard', 'pacific', 'atlantic', 'united', 'sun', 'new', 'great', 'prime', 'premier', 'advanced', 'applied', 'allied', 'associated', 'consolidated', 'integrated', 'universal']);

function addAlias(alias, sym) {
  const a = alias.trim().toLowerCase().replace(/\s+/g, ' ');
  if (a.length < 5 || GENERIC.has(a)) return;
  if (a.split(' ').length === 1 && a.length < 6) return; // 單字太短容易誤配
  if (!NAME_TO_TICKER.has(a)) NAME_TO_TICKER.set(a, sym);
}

for (const u of UNIVERSE_LIST) {
  if (!u.n) continue;
  addAlias(u.n, u.s);
  // 去掉 Inc. / Corp. / Holdings 等尾綴
  const clean = u.n
    .replace(/[,\s]+(inc\.?|corp\.?|corporation|company|co\.?|ltd\.?|limited|holdings?|group|technologies|technology|systems?|solutions?|enterprises?|international|plc|n\.v\.|s\.a\.|ag|se|trust|partners?|industries|resources?|pharmaceuticals?|therapeutics|biosciences?|energy|financial|bancorp|bancshares?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean && clean !== u.n) addAlias(clean, u.s);
  // 再用第一個詞（例如 Micron Technology → Micron）
  const first = clean.split(' ')[0];
  if (first && first.length >= 6) addAlias(first, u.s);
}
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = NAME_TO_TICKER.size
  ? new RegExp('\\b(' + [...NAME_TO_TICKER.keys()].sort((x, y) => y.length - x.length).map(escRe).join('|') + ')\\b', 'i')
  : null;

function tagNews(title) {
  if (!NAME_RE) return [];
  const m = NAME_RE.exec(title);
  if (!m) return [];
  const t = NAME_TO_TICKER.get(m[1].toLowerCase());
  return t ? [t] : [];
}
const glossary = readJson(path.join(HERE, 'glossary.json'), []);
const quoteMap = new Map((state.lastQuotes || []).map(q => [q.ticker, q]));

// ── 分類規則（由具體到宏觀）────────────────────────────────────────────
const RULES = [
  { re: /foundry|wafer|tsmc|台積|晶圓/, path: ['科技', '半導體', '晶圓代工'] },
  { re: /semiconductor|chip|nvidia|broadcom|amd\b|asml|gpu|晶片|芯片/, path: ['科技', '半導體', '芯片設計'] },
  { re: /cloud|azure|aws\b|data center|資料中心/, path: ['科技', '軟體與雲端', '雲端平台'] },
  { re: /software|saas|palantir|軟體/, path: ['科技', '軟體與雲端', '資料與 AI 軟體'] },
  { re: /google|alphabet|search|advertis|youtube/, path: ['科技', '網路平台', '搜尋與廣告'] },
  { re: /fda|drug|trial|pharma|biotech|lilly|glp|obesity|藥/, path: ['醫療保健', '製藥', '代謝與 GLP-1'] },
  { re: /bank|jpmorgan|deposit|net interest|lender/, path: ['金融', '銀行', '大型銀行'] },
  { re: /retail|costco|walmart|consumer|同店/, path: ['消費', '零售', '會員制零售'] },
  { re: /oil|opec|crude|exxon|refin|原油|油價/, path: ['能源', '綜合能源', '石油與天然氣'] },
  { re: /uber|lyft|ride-hailing|delivery/, path: ['交通與平台', '出行平台', '叫車與外送'] },
  { re: /fed\b|fomc|rate hike|rate cut|inflation|cpi\b|pce\b|treasury|yield|powell|央行|利率|通脹/, path: ['宏觀與市場', '貨幣政策'] },
  { re: /tariff|sanction|war\b|iran|geopolit|trade war|china|關稅|制裁|地緣/, path: ['宏觀與市場', '地緣與貿易'] },
  { re: /earnings|guidance|merger|acquisition|buyout|bankrupt|layoff|財報|併購/, path: ['宏觀與市場', '企業事件'] },
];

const stockByTicker = new Map(stocks.map(s => [s.ticker, s]));

const AUTO_WHY = {
  '宏觀與市場/貨幣政策': '利率與資金成本的方向會影響整體估值，重點看後續數據與官員談話。',
  '宏觀與市場/地緣與貿易': '影響供應鏈、成本與風險偏好，屬跨市場變數，未必只影響單一公司。',
  '宏觀與市場/企業事件': '公司層面事件，關鍵是它會不會改變原本的持有理由。',
  '宏觀與市場/其他': '屬市場整體消息，先看它是否改變你對風險的判斷。',
  '科技/半導體': '半導體需求與資本支出的訊號，會影響整個板塊的估值。',
  '科技/軟體與雲端': '企業 IT 支出與 AI 變現的訊號，影響軟體與雲端板塊。',
  '科技/網路平台': '廣告與平台經濟的訊號，影響流量變現的預期。',
  '醫療保健/製藥': '藥品需求、給付與臨床進展的訊號，直接影響營收預期。',
  '金融/銀行': '利率、信貸成本與資本市場活躍度的訊號。',
  '能源/綜合能源': '油氣價格與供給的訊號，直接影響現金流。',
  '消費/零售': '消費力與成本的訊號，影響同店銷售與利潤率。',
  '工業/資本財': '資本支出與建設週期的訊號。',
  '公用事業/電力': '電價、費率與利率的訊號，利率上升會壓抑估值。',
  '原材料/化學': '工業活動與原料價格的訊號。',
  '交通與平台/出行平台': '出行需求的訊號，影響訂單與單位經濟。',
};

function autoWhy(item) {
  const first = (item.c || [])[0] || '';
  let base = AUTO_WHY[first] || '先看它是否改變你對這家公司或市場的判斷，再決定要不要理會。';
  if ((item.tk || []).length) base = '與名單中的 ' + item.tk.slice(0, 3).join('、') + ' 相關；' + base;
  return base;
}

function autoSum(title) {
  let t = String(title || '').replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, '').trim();
  t = t.replace(/^(EXCLUSIVE|BREAKING|UPDATE|OPINION)\s*[:：-]\s*/i, '');
  if (t.length > 120) t = t.slice(0, 118) + '…';
  return t;
}

function catsFor(item) {
  const set = new Set();
  for (const t of item.tk || []) {
    const s = stockByTicker.get(t);
    if (s && s.path) set.add(s.path.join('/'));
  }
  const text = `${item.t || ''} ${item.summary || ''}`.toLowerCase();
  for (const r of RULES) if (r.re.test(text)) set.add(r.path.join('/'));
  if (!set.size) set.add('宏觀與市場/其他');
  return [...set];
}

// ── 讀新聞 ────────────────────────────────────────────────────────────
const dayFiles = existsSync(NEWS_DIR)
  ? readdirSync(NEWS_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse().slice(0, KEEP_DAYS)
  : [];

const days = [];
for (const file of dayFiles) {
  const d = file.slice(0, 10);
  const items = [];
  const sawTitle = new Set();
  const raw = readFileSync(path.join(NEWS_DIR, file), 'utf8').split('\n');
  for (const line of raw) {
    if (!line.trim()) continue;
    let x;
    try { x = JSON.parse(line); } catch { continue; }
    const key = (x.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 90);
    if (sawTitle.has(key)) continue;
    sawTitle.add(key);
    items.push(x);
  }
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  const news = items.map(x => ({
    t: x.title,
    u: x.url,
    dom: x.domain || x.sourceName || '',
    s: x.score ?? 0,
    k: x.kind || 'news',
    tk: x.tickers || [],
    p: x.publishedAt || x.at || '',
    summary: x.summary || '',
    sum: x.sum || '',
    why: x.why || '',
    a: x.autoWhy ? 1 : 0,
    m: x.at === 'model' ? 1 : 0,
  }));
  for (const n of news) {
    if (!n.tk.length) {
      const extra = tagNews(n.t || '');
      if (extra.length) n.tk = extra;
    }
    const paths = [];
    for (const t of (n.tk || [])) {
      const u = UNI_BY_TICKER.get(t);
      if (!u) continue;
      const pp = pathForUniverse(u);
      if (pp) paths.push(pp.join('/'));
    }
    if (paths.length) {
      n.c = [...new Set(paths)];
    } else {
      n.c = catsFor(n).filter(c => !c.startsWith('宏觀與市場'));
    }
  }
  days.push({ d, news });
}

// ── 讀簡報 / 警報 ─────────────────────────────────────────────────────
const digestMap = new Map();
if (existsSync(DIGEST_DIR)) {
  for (const f of readdirSync(DIGEST_DIR).filter(x => x.endsWith('.md'))) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})(?:-(.+))?\.md$/);
    if (!m) continue;
    const LABELS = { premarket: '開市前簡報', auto: '自動摘要' };
    const label = m[2] ? (LABELS[m[2]] || m[2]) : '收盤簡報';
    if (!digestMap.has(m[1])) digestMap.set(m[1], []);
    digestMap.get(m[1]).push({ label, md: readFileSync(path.join(DIGEST_DIR, f), 'utf8') });
  }
}

const alertMap = new Map();
if (existsSync(ALERTS_DIR)) {
  for (const f of readdirSync(ALERTS_DIR).filter(x => /^\d{4}-\d{2}-\d{2}\.md$/.test(x))) {
    alertMap.set(f.slice(0, 10), readFileSync(path.join(ALERTS_DIR, f), 'utf8').trim());
  }
}

for (const day of days) {
  day.digests = digestMap.get(day.d) || [];
  day.alerts = alertMap.get(day.d) || '';
}

// 有簡報但沒有新聞檔的日期也要出現
for (const d of digestMap.keys()) {
  if (!days.some(x => x.d === d)) {
    days.push({ d, news: [], digests: digestMap.get(d), alerts: alertMap.get(d) || '' });
  }
}
days.sort((a, b) => b.d.localeCompare(a.d));

// ── 建分類樹 ──────────────────────────────────────────────────────────
const root = { n: '全部', p: '', c: [], cnt: 0, map: new Map() };

function ensureNode(parts) {
  let cur = root;
  let acc = [];
  for (const name of parts) {
    acc.push(name);
    if (!cur.map.has(name)) {
      const node = { n: name, p: acc.join('/'), c: [], cnt: 0, map: new Map() };
      cur.map.set(name, node);
      cur.c.push(node);
    }
    cur = cur.map.get(name);
  }
  return cur;
}


function pathForUniverse(u) {
  const top = SECTOR_ZH_TO_PATH[u.sec] || '其他';
  const ind = String(u.ind || '');
  const has = (re) => re.test(ind);

  if (top === '科技') {
    if (has(/semiconductor|chip/i)) return ['科技', '半導體', '芯片設計'];
    if (has(/software|information technology|data storage/i)) return ['科技', '軟體與雲端', '應用軟體'];
    if (has(/internet|interactive media/i)) return ['科技', '網路平台', '搜尋與廣告'];
    if (has(/hardware|electronic|communication equipment/i)) return ['科技', '硬體與設備', '電子設備'];
    return ['科技', '其他科技', '其他'];
  }
  if (top === '醫療保健') {
    if (has(/drug|biotech|pharmaceutical/i)) return ['醫療保健', '製藥', '藥物與生技'];
    if (has(/plan|care|facilit|device|diagnostic|instrument/i)) return ['醫療保健', '醫療服務', '醫療服務'];
    return ['醫療保健', '其他醫療', '其他'];
  }
  if (top === '金融') {
    if (has(/bank/i)) return ['金融', '銀行', '銀行'];
    if (has(/insurance/i)) return ['金融', '保險', '保險'];
    if (has(/credit|payment|financial data|capital markets|asset management/i)) return ['金融', '支付與金融科技', '金融服務'];
    return ['金融', '其他金融', '其他'];
  }
  if (top === '消費') {
    if (has(/retail|store|grocery|discount/i)) return ['消費', '零售', '零售'];
    if (has(/restaurant|travel|lodging|gambling|leisure/i)) return ['消費', '休閒與餐飲', '休閒'];
    if (has(/beverage|food|household|personal|tobacco/i)) return ['消費', '必需品', '食品與日用品'];
    return ['消費', '其他消費', '其他'];
  }
  if (top === '能源') return ['能源', '綜合能源', '石油與天然氣'];
  if (top === '工業' && has(/transport|railroad|trucking|airline|shipping|logistics|airport/i)) {
    return ['交通與平台', '運輸', '運輸物流'];
  }
  if (top === '工業') {
    if (has(/aerospace|defense|machinery|construction|farm|industrial/i)) return ['工業', '資本財', '機械與國防'];
    if (has(/transport|railroad|trucking|airline|shipping|logistics/i)) return ['工業', '運輸', '運輸物流'];
    return ['工業', '其他工業', '其他'];
  }
  if (top === '原材料') {
    if (has(/chemical|gas|specialty/i)) return ['原材料', '化學', '化學與氣體'];
    if (has(/steel|aluminum|copper|gold|silver|metal|mining/i)) return ['原材料', '金屬與礦業', '金屬'];
    return ['原材料', '其他原材料', '其他'];
  }
  if (top === '公用事業') return ['公用事業', '電力', '電力與燃氣'];
  if (top === '房地產') return ['房地產', 'REIT', '不動產'];
  if (top === '通訊服務') return ['通訊服務', '媒體與電訊', '媒體'];
  return ['其他'];
}

for (const s of stocks) if (s.path) ensureNode(s.path);

// 股票庫也納入分類樹（只影響分類頁與計數）
for (const u of UNIVERSE_LIST) {
  const p = pathForUniverse(u);
  if (!p) continue;
  const node = ensureNode(p);
  node.stocks = node.stocks || [];
  node.stocks.push(u.s);
}
for (const day of days) for (const it of day.news) for (const c of it.c) if (!c.startsWith('宏觀與市場')) ensureNode(c.split('/'));

// 名單股掛到自己的節點
for (const s of stocks) {
  if (!s.path) continue;
  const node = ensureNode(s.path);
  node.stocks = node.stocks || [];
  if (!node.stocks.includes(s.ticker)) node.stocks.unshift(s.ticker);
}

// 計數（每條新聞在每個分類路徑上各加 1）
for (const day of days) {
  for (const it of day.news) {
    for (const c of it.c) {
      const parts = c.split('/');
      let cur = root;
      root.cnt++;
      for (const name of parts) {
        cur = cur.map.get(name);
        if (!cur) break;
        cur.cnt++;
      }
    }
  }
}

function countStocks(node) {
  let n = (node.stocks || []).length;
  for (const k of (node.c || [])) n += countStocks(k);
  return n;
}

function serialize(node) {
  const kids = [...node.c]
    .sort((a, b) => (a.n === '其他' ? 1 : 0) - (b.n === '其他' ? 1 : 0) || a.n.localeCompare(b.n, 'zh-Hant'))
    .map(serialize);
  return { n: node.n, p: node.p, cnt: node.cnt, c: kids, st: (node.stocks || []).slice(0, 400), sc: countStocks(node) };
}

// ── K 線資料（build 時抓，離線看也齊）────────────────────────────────
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CHART_RANGES = [
  { key: 'd1', range: '1d', interval: '5m' },
  { key: 'd5', range: '5d', interval: '30m' },
  { key: 'm1', range: '1mo', interval: '1d' },
  { key: 'y1', range: '1y', interval: '1d' },
  { key: 'y5', range: '5y', interval: '1wk' },
];

async function fetchChart(ticker, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const q = r?.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (![o, h, l, c].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
    bars.push({ t: ts[i] * 1000, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2) });
  }
  return bars;
}

async function fetchAllCharts(tickers) {
  const out = {};
  const queue = [...tickers];
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      const set = {};
      for (const spec of CHART_RANGES) {
        try { set[spec.key] = await fetchChart(t, spec.range, spec.interval); }
        catch { set[spec.key] = []; }
      }
      out[t] = set;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

const chartData = process.argv.includes('--no-charts') ? {} : await fetchAllCharts(stocks.map(s => s.ticker));

// ── 名單資料 ──────────────────────────────────────────────────────────
const stockOut = stocks.map(s => {
  const q = quoteMap.get(s.ticker) || {};
  return {
    ticker: s.ticker,
    name: s.name,
    path: s.path || ['其他', '未分類'],
    also: s.also || [],
    bucket: s.bucket || 'satellite',
    list: s.list || 'fundamental',
    conviction: s.conviction,
    thesis: s.thesis || '',
    invalidation: s.invalidation || '',
    background: s.background || '',
    recent: s.recent || '',
    thesisPlain: s.thesisPlain || '',
    invalidationPlain: s.invalidationPlain || '',
    catalystsPlain: s.catalystsPlain || '',
    catalysts: s.catalysts || [],
    lastReviewed: s.lastReviewed || '',
    quote: { price: q.price, chg1d: q.chg1d, chg5d: q.chg5d },
    charts: chartData[s.ticker] || null,
  };
});

const data = {
  generatedAt: new Date().toISOString(),
  days,
  stocks: stockOut,
  tree: serialize(root),
  glossary,
  stats: {
    days: days.length,
    news: days.reduce((n, d) => n + d.news.length, 0),
    stocks: stockOut.length,
  },
};

// ── 組 HTML ───────────────────────────────────────────────────────────
const css = readFileSync(path.join(SITE_DIR, 'style.css'), 'utf8');
const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
function riskReason(u) {
  if (!u || !u.tier || u.tier === 'na') return '可用資料不足，未能評級。';
  const bits = [];
  if (u.pm != null) bits.push(u.pm > 0 ? '有賺錢（淨利率約 ' + (u.pm * 100).toFixed(0) + '%）' : '目前仍在虧錢');
  if (u.fcf != null) bits.push(u.fcf > 0 ? '現金流是正的' : '現金流是負的');
  if (u.beta != null) bits.push(u.beta < 0.9 ? '股價比大盤穩' : u.beta < 1.4 ? '股價波動跟大盤差不多' : '股價波動明顯比大盤大');
  if (u.cap) {
    const t = u.cap >= 200e9 ? '大型股' : u.cap >= 10e9 ? '中型股' : '中小型股';
    bits.push(t);
  }
  if (u.pe != null && u.pe > 60) bits.push('估值偏高（本益比 ' + u.pe.toFixed(0) + ' 倍）');
  if (u.d2e != null && u.d2e > 1.5 && u.sec !== '金融' && u.sec !== '房地產') bits.push('負債偏高');
  const head = u.tier === 'low' ? '相對穩健：' : u.tier === 'high' ? '風險較高：' : '中等風險：';
  return head + bits.join('、') + '。';
}

for (const u of UNIVERSE_LIST) u.rr = riskReason(u);

if (UNIVERSE_LIST.length) data.universe = UNIVERSE_LIST;

const fmtDate = (p) => {
  try { return new Date(statSync(p).mtimeMs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' }); }
  catch { return ''; }
};
data.meta = {
  universe: fmtDate(path.join(HERE, 'universe.json')),
  profiles: fmtDate(path.join(HERE, 'profiles.json')),
  stories: fmtDate(path.join(HERE, 'stories.json')),
  glossary: fmtDate(path.join(HERE, 'glossary.json')),
};
const etfFile = path.join(HERE, 'etfs.json');
if (existsSync(etfFile)) data.etfs = JSON.parse(readFileSync(etfFile, 'utf8'));
const profilesFile = path.join(HERE, 'profiles.json');
if (existsSync(profilesFile)) data.profiles = JSON.parse(readFileSync(profilesFile, 'utf8'));
const termsFile = path.join(HERE, 'glossary-candidates.json');
if (existsSync(termsFile)) data.termCandidates = JSON.parse(readFileSync(termsFile, 'utf8'));

const storiesFile = path.join(HERE, 'stories.json');
if (existsSync(storiesFile)) data.stories = JSON.parse(readFileSync(storiesFile, 'utf8'));

const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const shell = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Market Desk · 檔案庫</title>
<style>
__CSS__
</style>
</head>
<body>
<header id="top">
  <div id="brand">Market Desk <span>檔案庫</span></div>
  <input id="q" placeholder="搜尋新聞、股票代號…（按 Enter）" autocomplete="off">
  <div id="stamp"></div>
</header>
<div id="wrap">
  <aside id="side"></aside>
  <main id="main"></main>
</div>
<script id="data" type="application/json">__DATA__</script>
<script>
__APP__
</script>
</body>
</html>
`;

const html = shell
  .replace('__CSS__', () => css)
  .replace('__DATA__', () => json)
  .replace('__APP__', () => app);

const OUT_FILE = path.join(SITE_DIR, 'index.html');
let unchanged = false;
try {
  const prev = readFileSync(OUT_FILE, 'utf8');
  unchanged = prev.length === html.length && prev === html;
} catch {}

if (!unchanged) writeFileSync(OUT_FILE, html, 'utf8');



if (!process.argv.includes('--quiet')) {
  console.log(unchanged ? 'site unchanged (skip write)' : `site built: ${OUT_FILE}`);
  console.log(`days=${data.stats.days} news=${data.stats.news} stocks=${data.stats.stocks} size=${(html.length / 1024).toFixed(0)}KB`);
}
