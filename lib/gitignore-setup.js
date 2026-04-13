// lib/gitignore-setup.js — Add signal files to global gitignore
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

const ENTRIES = ['.vscode/.claude-focus', '.vscode/.claude-focus-clicked'];

/**
 * Check if the global gitignore already contains our entries.
 * @returns {{ configured: boolean, gitignorePath: string | null }}
 */
function checkGitignoreStatus() {
  const gitignorePath = getGlobalGitignorePath();
  if (!gitignorePath) return { configured: false, gitignorePath: null };

  if (!fs.existsSync(gitignorePath)) return { configured: false, gitignorePath };

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const hasAll = ENTRIES.every(entry => content.includes(entry));
  return { configured: hasAll, gitignorePath };
}

/**
 * Add signal file entries to the global gitignore.
 * Creates the file if it doesn't exist. Sets git config if needed.
 * @returns {{ success: boolean, message: string }}
 */
function setupGitignore() {
  try {
    let gitignorePath = getGlobalGitignorePath();

    // If no global gitignore is configured, create one
    if (!gitignorePath) {
      gitignorePath = path.join(os.homedir(), '.gitignore_global');
      execSync(`git config --global core.excludesfile "${gitignorePath}"`, { encoding: 'utf8' });
    }

    // Read existing content
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }

    // Append missing entries
    const missing = ENTRIES.filter(entry => !content.includes(entry));
    if (missing.length === 0) {
      return { success: true, message: 'Global gitignore already configured.' };
    }

    const addition = '\n# Claude Terminal Focus signal files\n' + missing.join('\n') + '\n';
    fs.appendFileSync(gitignorePath, addition);

    return {
      success: true,
      message: `Added ${missing.length} entries to ${gitignorePath}`
    };
  } catch (err) {
    return { success: false, message: `Failed to set up gitignore: ${err.message}` };
  }
}

function getGlobalGitignorePath() {
  try {
    return execSync('git config --global core.excludesfile', { encoding: 'utf8' }).trim() || null;
  } catch (_) {
    return null;
  }
}

module.exports = { checkGitignoreStatus, setupGitignore };
