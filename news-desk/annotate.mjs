#!/usr/bin/env node
/**
 * news-desk/annotate.mjs — 把「內容摘要（sum）」與「意義（why）」寫進當日新聞
 *   node annotate.mjs --date=2026-11-04 --file=annotations.json
 * annotations.json 格式：{ "<key>": { "sum": "...", "why": "..." }, ... }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : null;
};

const date = argOf('date') || new Date().toISOString().slice(0, 10);
const file = argOf('file');
if (!file) { console.error('需要 --file=annotations.json'); process.exit(1); }

const map = JSON.parse(readFileSync(file, 'utf8'));
const target = path.join(HERE, 'news', `${date}.jsonl`);
if (!existsSync(target)) { console.error('找不到', target); process.exit(1); }

const lines = readFileSync(target, 'utf8').split('\n').filter(Boolean);
let n = 0;
const out = lines.map((line) => {
  const x = JSON.parse(line);
  const a = map[x.key];
  if (a && (a.sum || a.why)) {
    if (a.sum) x.sum = a.sum;
    if (a.why) x.why = a.why;
    n++;
  }
  return JSON.stringify(x);
});
writeFileSync(target, out.join('\n') + '\n', 'utf8');
console.log('annotated', n, 'of', lines.length, 'on', date);
