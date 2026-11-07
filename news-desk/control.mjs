#!/usr/bin/env node
/**
 * news-desk/control.mjs — 常駐掃描器（雙軌）
 *   新聞：每 60 秒（不抓報價，便宜、快）
 *   報價：每 5 分鐘
 *   解讀＋重建：每 5 分鐘（只補新的新聞）
 *
 * API：GET /status、POST /mode {"enabled":true|false}
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { readMode, writeMode } from './mode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7799;

const state = { lastNews: null, lastQuote: null, lastAnnotate: null, lastBuild: null };

function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, script), ...args], {
      cwd: HERE, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code));
  });
}

function log(line) {
  try { appendFileSync(path.join(HERE, 'control.log'), `${new Date().toISOString()} ${line}\n`); } catch {}
}

async function newsTick() {
  if (!readMode().enabled) return;
  state.lastNews = new Date().toISOString();
  log(`news-scan exit=${await run('collect.mjs', ['--quiet', '--no-quotes'])}`);
}

async function quoteTick() {
  if (!readMode().enabled) return;
  state.lastQuote = new Date().toISOString();
  log(`quote-scan exit=${await run('collect.mjs', ['--quiet'])}`);
}

async function annotateTick() {
  if (!readMode().enabled) return;
  state.lastAnnotate = new Date().toISOString();
  log(`annotate exit=${await run('annotate-auto.mjs', ['--all'])}`);
}

function mtime(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

function newestNewsMtime() {
  try {
    const dir = path.join(HERE, 'news');
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().slice(-2);
    return Math.max(0, ...files.map(f => mtime(path.join(dir, f))));
  } catch { return 0; }
}

async function buildTick() {
  if (!readMode().enabled) return;
  // 只有新聞真的變多才重建；報價單獨變動不值得重寫 9MB
  const idx = mtime(path.join(HERE, 'site', 'index.html'));
  if (idx && idx >= newestNewsMtime()) return;
  state.lastBuild = new Date().toISOString();
  log(`build exit=${await run('build-site.mjs', ['--quiet'])}`);
}

function json(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (req.url.startsWith('/status') && req.method === 'GET') {
    const m = readMode();
    json(res, 200, { enabled: m.enabled, updated: m.updated, mode: m.enabled ? 'auto' : 'paused', ...state });
    return;
  }

  if (req.url.startsWith('/mode') && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        const v = JSON.parse(body || '{}');
        const out = writeMode(v.enabled !== false);
        json(res, 200, { ok: true, ...out });
      } catch {
        json(res, 400, { ok: false });
      }
    });
    return;
  }

  json(res, 404, { ok: false });
});

process.on('uncaughtException', (e) => {
  try { appendFileSync(path.join(HERE, 'control.log'), new Date().toISOString() + ' crash ' + (e && e.stack) + '\n'); } catch {}
});
process.on('unhandledRejection', (e) => {
  try { appendFileSync(path.join(HERE, 'control.log'), new Date().toISOString() + ' reject ' + e + '\n'); } catch {}
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`control listening on http://127.0.0.1:${PORT} enabled=${readMode().enabled}`);
  newsTick();
  setTimeout(quoteTick, 3000);

  setInterval(newsTick, 60 * 1000);
  setInterval(quoteTick, 5 * 60 * 1000);
  setInterval(annotateTick, 60 * 1000);
  setInterval(buildTick, 3 * 60 * 1000);
});
