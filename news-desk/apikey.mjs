#!/usr/bin/env node
/**
 * news-desk/apikey.mjs — 讀 API 金鑰（不放在專案裡）
 * 順序：環境變數 → %APPDATA%\market-desk\key.txt → 專案內 .secrets.json（舊版相容）
 */
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function keyFile() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'market-desk', 'key.txt');
}

export function getKey() {
  const fromEnv = process.env.DEEPSEEK_API_KEY || process.env.ANNOTATE_API_KEY;
  if (fromEnv) return String(fromEnv).trim();

  const f = keyFile();
  if (existsSync(f)) {
    try {
      const v = readFileSync(f, 'utf8').trim();
      if (v) return v;
    } catch {}
  }

  const legacy = path.join(HERE, '.secrets.json');
  if (existsSync(legacy)) {
    try {
      const j = JSON.parse(readFileSync(legacy, 'utf8'));
      if (j.apiKey) return String(j.apiKey).trim();
    } catch {}
  }

  return '';
}

export function getConfig() {
  const legacy = path.join(HERE, '.secrets.json');
  if (existsSync(legacy)) {
    try { return JSON.parse(readFileSync(legacy, 'utf8')); } catch {}
  }
  return {};
}
