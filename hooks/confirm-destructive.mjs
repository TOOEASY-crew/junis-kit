#!/usr/bin/env node
// PreToolUse hook: turn a Junis call that deletes or overwrites into a
// question for the user, even when the tool was allow-listed. Covers the
// plugin's MCP tools, a user-scope `junis` MCP server, and the command line
// reached through Bash.
//
// Instructions in a skill are a request; this is the guarantee. An event it
// cannot read is left to the normal permission flow; a Junis call it cannot
// check is asked about. The list of what counts as destructive is shared with
// the bridge (skills/junis/scripts/lib/destructive.mjs), so annotations and
// prompts agree.
import { readFileSync } from 'node:fs';
import { destructiveApiReason, destructiveCommandReason, destructiveReason, secretReadReason } from '../skills/junis/scripts/lib/destructive.mjs';

let raw = '';
let event;
try {
  raw = readFileSync(0, 'utf8');
  event = JSON.parse(raw);
} catch {
  // not a hook event this script can read: leave the normal permission flow alone,
  // unless the text names the kit, in which case a call that cannot be checked is asked about
}

if (!(event && typeof event === 'object') && /junis(-kit|\.mjs)\b/i.test(raw)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'This Junis call could not be checked; confirm it.' },
    }),
  );
} else if (event && typeof event === 'object') {
  const raw = String(event.tool_name || '');
  const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  let reason = '';
  try {
    if (raw === 'Bash') {
      reason = destructiveCommandReason(input.command, { cwd: typeof event.cwd === 'string' ? event.cwd : undefined });
    } else if (raw.startsWith('mcp__')) {
      const name = raw.replace(/^mcp__.*__/, '');
      if (name === 'junis_api') {
        reason = destructiveApiReason(input.method, input.path, { query: input.query, body: input.body });
      } else if (name === 'junis_call_tool') {
        reason = destructiveReason(input.name, input.arguments || {});
      } else if (name === 'junis_read_tool') {
        // The bridge refuses a flagged read here and sends it to junis_call_tool, where this hook asks.
        reason = '';
      } else if (secretReadReason(name, input)) {
        // The bridge asks first and runs the read only with confirmed=true; ask the user on that call.
        reason = input.confirmed === true ? secretReadReason(name, input) : '';
      } else {
        reason = destructiveReason(name, input);
      }
    }
  } catch {
    // A Junis call that could not be checked is asked about, never let through.
    const junis = raw.startsWith('mcp__') ? /junis/i.test(raw) : raw === 'Bash' && /junis(-kit|\.mjs)\b/i.test(String(input.command || ''));
    if (junis) reason = 'This Junis call could not be checked; confirm it.';
  }
  if (reason) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
      }),
    );
  }
}
