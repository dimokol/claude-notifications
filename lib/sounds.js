// lib/sounds.js — Cross-platform sound playback
const { execFile } = require('child_process');
const path = require('path');

const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');

/**
 * Play a sound file. Non-blocking — fires and forgets.
 * @param {'notification' | 'task-complete'} soundName
 * @param {number} volume - 0.0 to 1.0 (supported on macOS/Linux only)
 */
function playSound(soundName, volume = 0.5) {
  const soundFile = path.join(SOUNDS_DIR, `${soundName}.wav`);
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      // macOS: afplay with volume (0-255 scale)
      const macVolume = Math.round(volume * 255).toString();
      execFile('afplay', ['-v', macVolume, soundFile], handleError);
    } else if (platform === 'win32') {
      // Windows: PowerShell SoundPlayer (no volume control)
      const psCommand = `(New-Object System.Media.SoundPlayer '${soundFile.replace(/'/g, "''")}').PlaySync()`;
      execFile('powershell', ['-NoProfile', '-Command', psCommand], handleError);
    } else {
      // Linux: try paplay (PulseAudio) first, fall back to aplay (ALSA)
      execFile('paplay', [soundFile], (err) => {
        if (err) {
          execFile('aplay', [soundFile], handleError);
        }
      });
    }
  } catch (_) {
    // Sound playback is best-effort — never crash the extension
  }
}

function handleError(err) {
  // Silently ignore — sound is non-critical
  if (err && process.env.CLAUDE_TERMINAL_FOCUS_DEBUG) {
    console.error('Sound playback error:', err.message);
  }
}

module.exports = { playSound };
