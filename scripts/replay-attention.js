#!/usr/bin/env node
// scripts/replay-attention.js — run the Stop classifier over real transcripts
// and print how his finished turns would have been classified.
//
//   node scripts/replay-attention.js [--projects DIR] [--limit N] [--samples N] [--seed N]
//
// Each main-session `system/stop_hook_summary` entry is one Stop. The replay
// rebuilds its payload from the transcript: last_assistant_message is the
// last assistant text before it; background_tasks is APPROXIMATED as launches
// ("launched successfully" / "running in background" tool results) without a
// <task-notification> for their tool-use id yet. In production the real
// payload carries background_tasks, so rule 1 is only estimated here; rules
// 2-4 run on exactly what the hook will see.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyStop, asksUser } = require('../lib/stop-classifier');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const projectsDir = arg('projects', path.join(os.homedir(), '.claude-dimo', 'projects'));
const limit = Number(arg('limit', 80));
const samples = Number(arg('samples', 10));
let seed = Number(arg('seed', 1));
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

function recentTranscripts() {
  const files = [];
  for (const d of fs.readdirSync(projectsDir)) {
    const dir = path.join(projectsDir, d);
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(dir, n);
      files.push({ f, m: fs.statSync(f).mtimeMs });
    }
  }
  return files.sort((a, b) => b.m - a.m).slice(0, limit).map(x => x.f);
}

const LAUNCH = /launched successfully|running in background/i;
const NOTIFIED = /<tool-use-id>(\S+?)<\/tool-use-id>/g;

function replayFile(file) {
  const out = [];
  const entries = [];
  const pending = new Map(); // tool_use_id -> description
  const toolNames = new Map();
  let lastText = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    if (o.isSidechain) continue;
    if (o.type === 'assistant') {
      for (const b of (o.message && o.message.content) || []) {
        if (b && b.type === 'text' && b.text.trim()) lastText = b.text;
        if (b && b.type === 'tool_use') toolNames.set(b.id, (b.input && (b.input.description || b.input.command)) || b.name);
      }
    }
    const raw = JSON.stringify(o);
    if (o.type === 'user' && Array.isArray(o.message && o.message.content)) {
      for (const b of o.message.content) {
        if (b && b.type === 'tool_result' && LAUNCH.test(JSON.stringify(b.content))) {
          pending.set(b.tool_use_id, toolNames.get(b.tool_use_id) || 'background task');
        }
      }
    }
    if (raw.includes('<task-notification>')) {
      for (const m of raw.matchAll(NOTIFIED)) pending.delete(m[1]);
    }
    if (o.type === 'system' && o.subtype === 'stop_hook_summary') {
      const payload = {
        last_assistant_message: lastText,
        background_tasks: [...pending.values()].map(description => ({ description })),
        session_crons: []
      };
      const r = classifyStop(payload, entries);
      // Label questions that won over a wait, so their samples can be checked.
      let label = `${r.state} / ${r.reason}`;
      if (r.state === 'needs-you' && asksUser(lastText)) {
        const silent = classifyStop({ ...payload, last_assistant_message: '' }, entries);
        if (silent.state === 'waiting') label = `needs-you / asked while waiting (${silent.reason})`;
      }
      out.push({ file, ts: o.timestamp, msg: lastText, label, ...r });
      continue;
    }
    entries.push(o);
  }
  return out;
}

const all = [];
for (const f of recentTranscripts()) {
  try { all.push(...replayFile(f)); } catch (e) { console.error(`skip ${f}: ${e.message}`); }
}

const byKey = new Map();
for (const r of all) {
  const k = r.label;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(r);
}
console.log(`${all.length} Stops in the ${limit} most recent transcripts under ${projectsDir}\n`);
for (const [k, rows] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(rows.length).padStart(5)}  ${(100 * rows.length / all.length).toFixed(1).padStart(5)}%  ${k}`);
}
for (const [k, rows] of byKey) {
  console.log(`\n## ${k}: ${Math.min(samples, rows.length)} random samples`);
  const pick = [...rows].sort(() => rand() - 0.5).slice(0, samples);
  for (const r of pick) {
    const shown = k.includes('asked') ? r.detail : (r.msg.split('\n').find(l => l.trim()) || '(no text)');
    const first = shown.trim().slice(0, 110);
    const proj = path.basename(path.dirname(r.file)).replace(/^-Users-dimokol-Documents-/, '').slice(0, 28);
    console.log(`- [${proj}] ${first}${r.reason === 'background' || r.reason === 'peer' ? `   (${r.detail})` : ''}`);
  }
}
