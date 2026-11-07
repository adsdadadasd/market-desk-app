#!/usr/bin/env node
/**
 * news-desk/refresh.mjs — 一次更新股票庫、公司資料、公司故事
 *   node refresh.mjs
 * 股票清單每週跑一次即可（7 天快取）；只補新的，不會重複花錢。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const run = (label, file, args = []) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [path.join(HERE, file), ...args], { stdio: 'inherit', cwd: HERE });
  console.log(`(${label} exit ${r.status})`);
};

run('股票清單與風險', 'universe.mjs');
run('公司基本資料', 'profiles.mjs');
run('公司故事', 'stories.mjs', ['--all']);
run('名詞候選', 'terms.mjs');
run('重建網站', 'build-site.mjs', ['--quiet']);
console.log('\n全部完成');
