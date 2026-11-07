#!/usr/bin/env node
/**
 * news-desk/mode.mjs — 掃描開關（雙軌：新聞 1 分鐘／報價 5 分鐘）
 *
 *   node mode.mjs          看目前狀態
 *   node mode.mjs on       開始掃描
 *   node mode.mjs off      暫停
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'scan-mode.json');

const DEFAULTS = { enabled: true, newsSeconds: 60, quoteSeconds: 300, updated: null };

export function readMode() {
  if (!existsSync(FILE)) return { ...DEFAULTS };
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...j, enabled: j.enabled !== false };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeMode(enabled) {
  const prev = readMode();
  const v = { ...prev, enabled: !!enabled, updated: new Date().toISOString() };
  writeFileSync(FILE, JSON.stringify(v, null, 2), 'utf8');
  return v;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2];
  if (cmd === 'on' || cmd === 'off') {
    const v = writeMode(cmd === 'on');
    console.log(cmd === 'on' ? '掃描已開始' : '掃描已暫停', v.updated);
  } else {
    const v = readMode();
    console.log(v.enabled ? '掃描中（新聞 1 分鐘／報價 5 分鐘）' : '已暫停', v.updated || '');
  }
}
