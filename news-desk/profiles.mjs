#!/usr/bin/env node
/**
 * news-desk/profiles.mjs — 為股票庫每檔股票抓公司背景（Yahoo assetProfile）
 * 產出 site/profiles/<A-Z>.js，按首字母分塊，詳情頁只載入需要的一塊。
 *
 *   node profiles.mjs          抓取（約 4-6 分鐘，7 天快取）
 *   node profiles.mjs --no-fetch  只用快取重建
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache', 'profile');
const OUT = path.join(HERE, 'site', 'profiles');
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const NO_FETCH = process.argv.includes('--no-fetch');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SECTOR = {
  Technology: '科技', 'Financial Services': '金融服務', Healthcare: '醫療保健', 'Consumer Cyclical': '非必需消費',
  'Consumer Defensive': '必需消費', Energy: '能源', Industrials: '工業', 'Basic Materials': '原材料',
  'Real Estate': '房地產', Utilities: '公用事業', 'Communication Services': '通訊服務',
};

const INDUSTRY = {
  'Consumer Electronics': '消費電子', Semiconductors: '半導體', 'Software—Application': '應用軟體',
  'Software—Infrastructure': '基礎軟體', 'Internet Content & Information': '網路內容與資訊',
  'Internet Retail': '網路零售', 'Banks—Diversified': '綜合銀行', 'Banks—Regional': '地區銀行',
  'Oil & Gas Integrated': '綜合油氣', 'Oil & Gas E&P': '油氣勘探', 'Oil & Gas Midstream': '油氣中游',
  'Drug Manufacturers—General': '製藥', Biotechnology: '生物科技', 'Auto Manufacturers': '汽車製造',
  'Telecom Services': '電訊服務', 'Aerospace & Defense': '航太與國防', 'Insurance—Diversified': '綜合保險',
  'Asset Management': '資產管理', 'Capital Markets': '資本市場', 'Medical Devices': '醫療器材',
  'Diagnostics & Research': '診斷與研究', 'Discount Stores': '折扣零售', Restaurants: '餐飲',
  Airlines: '航空', Railroads: '鐵路', 'Utilities—Regulated Electric': '受監管電力',
  'REIT—Retail': '零售 REIT', 'REIT—Residential': '住宅 REIT', 'REIT—Industrial': '工業 REIT',
  'Specialty Chemicals': '特種化學', Steel: '鋼鐵', Gold: '黃金', Copper: '銅',
  'Beverages—Non-Alcoholic': '非酒精飲料', 'Packaged Foods': '包裝食品',
  'Household & Personal Products': '家庭與個人用品', 'Apparel Manufacturing': '服裝製造',
  'Specialty Retail': '專門零售', 'Home Improvement Retail': '家居裝修零售', 'Grocery Stores': '超市',
  'Healthcare Plans': '醫療保險', 'Medical Care Facilities': '醫療機構', 'Engineering & Construction': '工程建設',
  'Building Products & Equipment': '建材與設備', 'Farm & Heavy Construction Machinery': '農機與重機',
  Trucking: '貨運', 'Marine Shipping': '航運', 'Travel Services': '旅遊服務', Lodging: '酒店',
  Gambling: '博彩', Entertainment: '娛樂', Broadcasting: '廣播', Publishing: '出版',
  'Electronic Components': '電子元件', 'Communication Equipment': '通訊設備', 'Computer Hardware': '電腦硬體',
  Solar: '太陽能', 'Electrical Equipment & Parts': '電氣設備', 'Packaging & Containers': '包裝容器',
  'Agricultural Inputs': '農業投入', 'Specialty Industrial Machinery': '專用工業機械',
  'Waste Management': '廢棄物管理', 'Security & Protection Services': '保安服務',
  'Information Technology Services': 'IT 服務', 'Data Storage': '資料儲存',
  'Semiconductor Equipment & Materials': '半導體設備與材料', 'Electronic Gaming & Multimedia': '遊戲與多媒體',
  'Luxury Goods': '奢侈品', 'Resorts & Casinos': '度假村與賭場', 'Auto Parts': '汽車零件',
  'Credit Services': '信貸服務', 'Financial Data & Stock Exchanges': '金融數據與交易所',
  'Insurance—Life': '人壽保險', 'Insurance—Property & Casualty': '產物保險', 'Insurance—Reinsurance': '再保險',
  Conglomerates: '綜合企業', Tobacco: '菸草', Brewers: '啤酒', Confectioners: '糖果', 'Farm Products': '農產品',
  'Oil & Gas Refining & Marketing': '煉油與銷售', 'Oil & Gas Equipment & Services': '油氣設備服務',
  'Utilities—Independent Power Producers': '獨立發電', 'Utilities—Renewable': '再生能源',
  'Utilities—Regulated Gas': '受監管燃氣', 'Utilities—Diversified': '綜合公用事業',
  'REIT—Diversified': '綜合 REIT', 'REIT—Office': '辦公 REIT', 'REIT—Healthcare Facilities': '醫療 REIT',
  'REIT—Specialty': '特殊 REIT', 'Real Estate Services': '房地產服務', 'Real Estate—Development': '房地產開發',
  'Shell Companies': '空殼公司', 'Staffing & Employment Services': '人力服務', 'Industrial Distribution': '工業分銷',
};

const COUNTRY = { 'United States': '美國', China: '中國', 'United Kingdom': '英國', Canada: '加拿大', Japan: '日本', Taiwan: '台灣', 'Hong Kong': '香港', Israel: '以色列', Ireland: '愛爾蘭', Switzerland: '瑞士', Germany: '德國', France: '法國', Netherlands: '荷蘭', Singapore: '新加坡', India: '印度', 'South Korea': '南韓', Australia: '澳洲', Brazil: '巴西', Mexico: '墨西哥', 'Cayman Islands': '開曼群島', Bermuda: '百慕達', Luxembourg: '盧森堡' };

let cookie = '', crumb = '';
async function ensureCrumb(force = false) {
  if (crumb && !force) return;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'user-agent': UA }, redirect: 'follow' });
  cookie = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  crumb = (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': UA, cookie } }).then(r => r.text())).trim();
  if (!crumb || crumb.startsWith('<')) throw new Error('crumb');
}

const universe = JSON.parse(readFileSync(path.join(HERE, 'universe.json'), 'utf8'));
console.log('股票', universe.length, '檔');

let done = 0, failed = 0, cached = 0;
async function worker(queue) {
  while (queue.length) {
    const it = queue.shift();
    const cf = path.join(CACHE, `${it.s}.json`);
    let p = null;
    if (existsSync(cf) && Date.now() - statSync(cf).mtimeMs < 7 * 864e5) { p = JSON.parse(readFileSync(cf, 'utf8')); cached++; }
    if (!p && !NO_FETCH) {
      for (let a = 0; a < 3 && !p; a++) {
        try {
          await ensureCrumb();
          const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${it.s}?modules=assetProfile&crumb=${encodeURIComponent(crumb)}`, { headers: { 'user-agent': UA, cookie }, signal: AbortSignal.timeout(15000) });
          if (r.status === 401) { await ensureCrumb(true); throw new Error('crumb'); }
          const j = await r.json();
          p = j?.quoteSummary?.result?.[0]?.assetProfile || null;
          if (!p) throw new Error('empty');
        } catch { await sleep(500); }
      }
      if (p) writeFileSync(cf, JSON.stringify(p), 'utf8'); else failed++;
      await sleep(45);
    }
    it._p = p;
    done++;
    if (done % 300 === 0) console.log(`  ${done}/${universe.length}（快取 ${cached}、失敗 ${failed}）`);
  }
}
const q = [...universe];
await Promise.all(Array.from({ length: 6 }, () => worker(q)));

const buckets = {};
for (const it of universe) {
  const p = it._p;
  if (!p) continue;
  const letter = /^[A-Z]$/.test(it.s[0]) ? it.s[0] : '0';
  (buckets[letter] = buckets[letter] || {})[it.s] = {
    b: [
      p.city ? `總部：${p.city}${p.country ? '（' + (COUNTRY[p.country] || p.country) + '）' : ''}` : '',
      p.fullTimeEmployees ? `員工：約 ${Number(p.fullTimeEmployees).toLocaleString('en-US')} 人` : '',
      p.sector ? `產業：${SECTOR[p.sector] || p.sector}${p.industry ? '／' + (INDUSTRY[p.industry] || p.industry) : ''}` : '',
    ].filter(Boolean).join('｜'),
    y: p.industry ? (INDUSTRY[p.industry] || p.industry) : '',
    e: p.fullTimeEmployees || null,
    w: p.website || '',
    s: (p.longBusinessSummary || '').slice(0, 380),
  };
}

// 合併成一份 profiles.json，供網站內嵌
const flat = {};
for (const obj of Object.values(buckets)) Object.assign(flat, obj);
writeFileSync(path.join(HERE, 'profiles.json'), JSON.stringify(flat), 'utf8');

let files = 0;
for (const [letter, obj] of Object.entries(buckets)) {
  const js = 'window.__PROFILES__=Object.assign(window.__PROFILES__||{},' + JSON.stringify(obj) + ');';
  writeFileSync(path.join(OUT, `${letter}.js`), js, 'utf8');
  files++;
}
console.log(`完成：${Object.keys(buckets).reduce((a, k) => a + Object.keys(buckets[k]).length, 0)} 檔有背景，${files} 個分塊，失敗 ${failed}`);
