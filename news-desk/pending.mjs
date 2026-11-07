#!/usr/bin/env node
/**
 * news-desk/pending.mjs — 列出當日尚未寫「內容摘要＋意義」的高分新聞
 *   node pending.mjs --date=2026-11-04 --limit=10
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : d;
};

const date = argOf('date', new Date().toISOString().slice(0, 10));
const limit = Number(argOf('limit', '10'));
const minScore = Number(argOf('minScore', '6'));
const f = path.join(HERE, 'news', `${date}.jsonl`);
if (!existsSync(f)) { console.log('[]'); process.exit(0); }

const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const pending = rows
  .filter(x => !x.sum && (x.score || 0) >= minScore && x.kind !== 'price')
  .sort((a, b) => (b.score || 0) - (a.score || 0))
  .slice(0, limit)
  .map(x => ({ key: x.key, score: x.score, title: x.title, domain: x.domain, tickers: x.tickers }));

console.log(JSON.stringify(pending, null, 2));
