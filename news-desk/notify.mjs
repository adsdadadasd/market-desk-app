#!/usr/bin/env node
/**
 * news-desk/notify.mjs — 推送通知到手機（ntfy.sh）
 *
 *   node notify.mjs "訊息內容"
 *   node notify.mjs --title "收盤簡報" --priority default --tags chart "訊息"
 *   node notify.mjs --json '{"title":"x","message":"y"}'
 *   node notify.mjs --dry "只印不送"
 *
 * topic 在 config.json 的 ntfy.topic；換 topic 就等於換頻道。
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(path.join(HERE, 'config.json'), 'utf8'));

/** ntfy 的 HTTP header 只保證 ASCII，中文標題會被某些客戶端吃掉，所以標題固定用英文。 */
function asciiTitle(t) {
  const s = String(t || '').replace(/[^\x20-\x7E]/g, '').trim();
  return s || 'Market Desk';
}

export function ntfyTopic() {
  const n = CONFIG.ntfy || {};
  const server = (process.env.NTFY_SERVER || n.server || 'https://ntfy.sh').replace(/\/+$/, '');
  let topic = process.env.NTFY_TOPIC || n.topic || '';
  if (!topic) {
    try {
      const f = path.join(os.homedir(), 'AppData', 'Roaming', 'market-desk', 'topic.txt');
      topic = readFileSync(f, 'utf8').trim();
    } catch {}
  }
  return { server, topic };
}

/**
 * @param {{title?:string,message:string,priority?:string,tags?:string[],click?:string,dry?:boolean}} o
 */
export async function sendNtfy({ title = 'Market Desk', message, priority = 'default', tags = [], click, dry = false }) {
  if (!message || !String(message).trim()) throw new Error('訊息是空的');
  const { server, topic } = ntfyTopic();
  if (!topic) throw new Error('config.json 的 ntfy.topic 未設定（到 ntfy.sh 揀一個長隨機 topic）');

  const headers = {
    Title: asciiTitle(title),
    Priority: priority,
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (tags.length) headers.Tags = tags.join(',');
  if (click) headers.Click = click;

  if (dry) return { dry: true, url: `${server}/${topic}`, headers, body: message };

  const url = `${server}/${encodeURIComponent(topic)}`;
  const res = await fetch(url, { method: 'POST', headers, body: String(message).slice(0, 3900) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${text.slice(0, 200)}`);
  return { ok: true, status: res.status, response: text.trim() };
}

function parseArgs(argv) {
  const out = { message: '', title: 'Market Desk', priority: 'default', tags: [], click: '', dry: false, json: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') out.title = argv[++i] ?? out.title;
    else if (a === '--priority') out.priority = argv[++i] ?? out.priority;
    else if (a === '--tags') out.tags = String(argv[++i] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--click') out.click = argv[++i] ?? '';
    else if (a === '--dry') out.dry = true;
    else if (a === '--json') out.json = argv[++i] ?? '';
    else rest.push(a);
  }
  out.message = rest.join(' ');
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const a = parseArgs(process.argv.slice(2));
    let payload = a;
    if (a.json) {
      try { payload = { ...a, ...JSON.parse(a.json) }; } catch { console.error('--json 解析失敗'); process.exit(3); }
    }
    if (!payload.message) {
      console.error('用法：node notify.mjs "訊息" [--title T] [--priority high] [--tags a,b] [--click URL] [--dry]');
      process.exit(3);
    }
    try {
      const r = await sendNtfy(payload);
      if (r.dry) console.log('[dry]', r.url, JSON.stringify(r.headers), '\n', r.body);
      else console.log('sent', r.status, r.response);
    } catch (e) {
      console.error('推送失敗：', e.message);
      process.exit(2);
    }
  })();
}
