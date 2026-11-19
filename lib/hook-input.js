// lib/hook-input.js — classify Claude Code hook stdin into the extension's
// two-type event model, with notification_type awareness.
//
// Claude Code's `Notification` hook carries a `notification_type` field
// (documented: permission_prompt, idle_prompt, auth_success,
// elicitation_dialog, elicitation_complete, elicitation_response, and — from
// v2.1.198 — agent_needs_input / agent_completed for background agents).
// Treating every Notification as an attention event is wrong in both
// directions:
//   - auth_success / elicitation_complete / elicitation_response are pure
//     status updates — notifying "Waiting for your response" on a login
//     success is noise. They are SKIPPED entirely (before dedup, so they
//     don't pollute the session's lastEvent state). So are the agent-view
//     types agent_needs_input / agent_completed since 3.9.0 (see below).
//   - elicitation_dialog announces a genuinely NEW attention point that has
//     no Stop/PermissionRequest primary of its own. If it kept the hookEventName "Notification"
//     the stage-dedup machine would suppress it as a trailer forever.
//     It gets a synthetic primary dedup name instead, so the primary
//     escape path in lib/stage-dedup.js applies (burst window still
//     collapses re-fires within 3s).
//   - permission_prompt / idle_prompt (and unknown/missing types) keep the
//     classic trailer semantics: their attention point is announced by a
//     primary (Stop / PermissionRequest / PreToolUse) and the bare
//     Notification only re-states it, ≥6s later and only if the user is
//     idle (observed in Claude Code 2.1.202).

// agent_needs_input / agent_completed (agent view, about background
// sessions) are skipped since 3.9.0: each background session is a Claude
// process with our hooks, so its own PermissionRequest/Stop already notify,
// and the session that launched it reports the result. Keeping them made
// two notifications for one event.
const SKIP_NOTIFICATION_TYPES = new Set([
  'auth_success',
  'elicitation_complete',
  'elicitation_response',
  'agent_needs_input',
  'agent_completed'
]);

// notification_type → { event, dedupEventName }. Anything not listed keeps
// trailer semantics ({ event: 'waiting', dedupEventName: 'Notification' }).
const PRIMARY_NOTIFICATION_TYPES = {
  elicitation_dialog: { event: 'waiting', dedupEventName: 'ElicitationNotification' }
};

/**
 * @param {object} input parsed hook stdin (may be partial)
 * @returns {{skip: true} | {skip: false, event: 'waiting'|'completed',
 *            hookEventName: string, dedupEventName: string}}
 *   `hookEventName` is the raw name (for logs/signal); `dedupEventName` is
 *   what the stage-dedup machine should reason about.
 */
function classifyHookInput(input) {
  const raw = (input && typeof input.hook_event_name === 'string') ? input.hook_event_name : '';
  const lower = raw.toLowerCase();

  if (lower === 'stop') {
    return { skip: false, event: 'completed', hookEventName: raw, dedupEventName: raw };
  }

  if (lower === 'notification') {
    const nType = (input && typeof input.notification_type === 'string') ? input.notification_type : '';
    if (SKIP_NOTIFICATION_TYPES.has(nType)) return { skip: true };
    const primary = PRIMARY_NOTIFICATION_TYPES[nType];
    if (primary) {
      return { skip: false, event: primary.event, hookEventName: raw, dedupEventName: primary.dedupEventName };
    }
    return { skip: false, event: 'waiting', hookEventName: raw, dedupEventName: raw };
  }

  // PermissionRequest, PreToolUse, and anything future default to a
  // primary "waiting" attention point — matches the historical behavior
  // where any non-Notification event may escape the burst window.
  return { skip: false, event: 'waiting', hookEventName: raw, dedupEventName: raw };
}

const MAX_QUESTION_LEN = 120;

/**
 * Extract the question text from an AskUserQuestion tool_input so banners
 * can show WHAT Claude is asking instead of a generic "waiting" line.
 * PermissionRequest and PreToolUse hook inputs both carry tool_name +
 * tool_input. Returns '' when not applicable/malformed.
 */
function extractQuestionText(toolName, toolInput) {
  if (toolName !== 'AskUserQuestion') return '';
  if (!toolInput || typeof toolInput !== 'object') return '';
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const first = questions.find(q => q && typeof q.question === 'string' && q.question.trim() !== '');
  if (!first) return '';
  let text = first.question.trim().replace(/\s+/g, ' ');
  if (text.length > MAX_QUESTION_LEN) text = text.slice(0, MAX_QUESTION_LEN - 1) + '…';
  return text;
}

module.exports = {
  classifyHookInput,
  extractQuestionText,
  SKIP_NOTIFICATION_TYPES,
  PRIMARY_NOTIFICATION_TYPES,
  MAX_QUESTION_LEN
};
