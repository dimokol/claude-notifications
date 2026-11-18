// lib/host-optout.js — "this Claude session is not in a terminal" opt-out.
//
// Some hosts run `claude` headlessly with the user's own config dir, so our
// hooks are installed and fire for a session that has no VS Code terminal and
// no user watching it. The host already announces those events itself, so the
// user gets two banners for one event. A host can suppress ours by exporting a
// variable into the CLI's environment:
//
//   CLAUDE_NOTIFICATIONS_SKIP=1   generic, for any host
//   OCTOSHELL_AGENT=1             OctoShell sets this on every agent it spawns
//
// "1", "true", "yes" and "on" (any case) mean skip; "0", "false", "" and an unset
// variable mean notify as usual, so a host can turn it off per session without
// unsetting anything.

const SKIP_VARS = ['CLAUDE_NOTIFICATIONS_SKIP', 'OCTOSHELL_AGENT'];
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** True when the environment asks us to stay silent for this session. */
function shouldSkipForHost(env) {
  const e = env || process.env;
  for (const name of SKIP_VARS) {
    const raw = e[name];
    if (typeof raw !== 'string') continue;
    if (TRUTHY.has(raw.trim().toLowerCase())) return true;
  }
  return false;
}

module.exports = { shouldSkipForHost, SKIP_VARS };
