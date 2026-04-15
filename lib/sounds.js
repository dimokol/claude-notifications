// lib/sounds.js — Cross-platform sound playback, OS sound detection, sound resolution
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');

/**
 * Play a bundled sound by name. Non-blocking — fires and forgets.
 * @param {'notification' | 'task-complete'} soundName
 * @param {number} volume - 0.0 to 1.0
 */
function playSound(soundName, volume = 0.5) {
  const soundFile = path.join(SOUNDS_DIR, `${soundName}.wav`);
  playSoundFile(soundFile, volume * 100);
}

/**
 * Play any sound file by absolute path. Non-blocking — fires and forgets.
 * @param {string} filePath - Absolute path to audio file
 * @param {number} volume - 0 to 100
 */
function playSoundFile(filePath, volume = 50) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    if (process.platform === 'darwin') {
      const macVol = Math.round((volume / 100) * 255).toString();
      execFile('afplay', ['-v', macVol, filePath], handleError);
    } else if (process.platform === 'win32') {
      const psCmd = `(New-Object System.Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`;
      execFile('powershell', ['-NoProfile', '-Command', psCmd], handleError);
    } else {
      execFile('paplay', [filePath], (err) => {
        if (err) execFile('aplay', [filePath], handleError);
      });
    }
  } catch (_) {}
}

/**
 * Discover system sounds available on the current OS.
 * @returns {{ label: string, path: string }[]}
 */
function discoverSystemSounds() {
  const sounds = [];
  try {
    if (process.platform === 'darwin') {
      const dir = '/System/Library/Sounds';
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          if (file.endsWith('.aiff')) {
            sounds.push({ label: path.basename(file, '.aiff'), path: path.join(dir, file) });
          }
        }
      }
    } else if (process.platform === 'win32') {
      const dir = 'C:\\Windows\\Media';
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          if (file.endsWith('.wav')) {
            sounds.push({ label: path.basename(file, '.wav'), path: path.join(dir, file) });
          }
        }
      }
    } else {
      for (const dir of ['/usr/share/sounds/freedesktop/stereo', '/usr/share/sounds']) {
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            if (file.match(/\.(wav|ogg|oga)$/)) {
              sounds.push({ label: path.basename(file, path.extname(file)), path: path.join(dir, file) });
            }
          }
        }
      }
    }
  } catch (_) {}
  return sounds;
}

/**
 * Resolve a sound setting string to an absolute file path.
 * @param {string} setting - e.g. "bundled:task-complete", "system:Glass", "custom", "none"
 * @param {string} customPath - user-provided path (used when setting is "custom")
 * @param {string} extensionPath - context.extensionPath
 * @returns {string|null}
 */
function resolveSoundPath(setting, customPath, extensionPath) {
  if (!setting || setting === 'none') return null;
  if (setting === 'custom') return customPath || null;
  if (setting.startsWith('bundled:')) {
    const name = setting.replace('bundled:', '');
    return path.join(extensionPath, 'sounds', `${name}.wav`);
  }
  if (setting.startsWith('system:')) {
    const name = setting.replace('system:', '');
    const systemSounds = discoverSystemSounds();
    const match = systemSounds.find(s => s.label === name);
    return match ? match.path : null;
  }
  return null;
}

function handleError(err) {
  if (err && process.env.CLAUDE_TERMINAL_FOCUS_DEBUG) {
    console.error('Sound playback error:', err.message);
  }
}

module.exports = { playSound, playSoundFile, discoverSystemSounds, resolveSoundPath };
