// lib/transcript-turn.js — read the current turn's entries from a Claude Code
// transcript without loading the whole file. Transcripts reach tens of MB, and
// the Stop classifier only needs everything since the last human prompt, so
// read backwards in growing windows until one holds a human prompt.

const fs = require('fs');
const { entryOrigin } = require('./stop-classifier');

const DEFAULT_CHUNK = 256 * 1024;
const DEFAULT_MAX = 8 * 1024 * 1024;

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift(); // torn line at the window's start
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch (_) {}
  }
  return out;
}

/**
 * @returns {object[]} entries from the last human prompt (inclusive) to the
 *   end; when none is found within maxBytes, everything that was read.
 */
function readTurnEntries(transcriptPath, { chunkBytes = DEFAULT_CHUNK, maxBytes = DEFAULT_MAX } = {}) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    let window = Math.min(chunkBytes, size);
    for (;;) {
      const buf = Buffer.alloc(window);
      fs.readSync(fd, buf, 0, window, size - window);
      const entries = parseLines(buf.toString('utf8'), window < size);
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entryOrigin(entries[i]) === 'human') return entries.slice(i);
      }
      if (window >= size || window >= maxBytes) return entries;
      window = Math.min(window * 2, size, maxBytes);
    }
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
  }
}

module.exports = { readTurnEntries };
