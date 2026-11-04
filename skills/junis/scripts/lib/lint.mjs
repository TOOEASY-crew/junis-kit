// Instruction linter.
//
// The platform's agent runtime treats {identifier} inside an instruction as a
// session-state lookup. A name that is not in state is replaced by an empty
// string (only {artifact.name} still fails the call), so an unguarded brace
// silently deletes that part of the instruction or feeds the agent empty
// input. This check mirrors the runtime's matching rule and runs before any
// instruction is sent to the platform.

// Keys the platform registers as session state. They are reliably filled on
// the orchestrator's own turn; elsewhere the optional form is still safer.
export const KNOWN_STATE_KEYS = new Set([
  'current_time',
  'current_time_kst',
  'user_email',
  'user_id',
  'user_name',
  'admin_status',
  'owner_status',
  'organization_id',
  'organization_name',
  'organization_slug',
  'session_id',
  'session_created_at',
  'billing_user_id',
  'processing',
  'cancelled',
  'title',
]);

const STATE_PREFIXES = new Set(['app', 'user', 'temp']);
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function isStateReference(value) {
  const parts = value.split(':');
  if (parts.length === 1) return IDENTIFIER.test(value);
  return parts.length === 2 && STATE_PREFIXES.has(parts[0]) && IDENTIFIER.test(parts[1]);
}

const SECRET_PATTERNS = [
  ['Junis API key', /jns_[a-z]+_[A-Za-z0-9_-]{16,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Bearer token', /Bearer\s+[A-Za-z0-9._-]{24,}/],
  ['Stripe-style key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/], // pk_live_ is a publishable key, meant for web pages
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack app token', /\bxapp-\d-[A-Za-z0-9-]{20,}/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  // The header alone is only a name; key material must follow it.
  // (Old-style encrypted keys put "Proc-Type:" and "DEK-Info:" lines before it.)
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----\s*(?:[A-Za-z-]+:[^\n]*\n\s*)*[A-Za-z0-9+/=]{40,}/],
];

// Line numbers from one pass over the text (a slice per finding grew
// quadratically with the number of findings).
function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= index) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

export function lintInstruction(text, { allowedKeys = [] } = {}) {
  const allowed = new Set([...KNOWN_STATE_KEYS, ...allowedKeys]);
  const findings = [];
  const lineAt = lineIndex(text);

  // The runtime reads /\{+[^{}]*\}+/. The same matches, found from the
  // innermost brace and widened left over the opening run, in linear time
  // (that pattern backtracks quadratically on a long run of "{").
  for (const found of text.matchAll(/\{[^{}]*\}+/g)) {
    let start = found.index;
    while (start > 0 && text[start - 1] === '{') start -= 1;
    const match = { 0: text.slice(start, found.index) + found[0], index: start };
    const inner = match[0].replace(/^\{+/, '').replace(/\}+$/, '').trim();
    if (inner.replace(/\?$/, '').startsWith('artifact.')) {
      findings.push({
        level: 'error',
        rule: 'brace-artifact',
        line: lineAt(match.index),
        text: match[0],
        message: 'Artifact references are not supported: every run of this agent fails, and saving a new one is rejected.',
        fix: 'Remove it or describe the input in words.',
      });
      continue;
    }
    if (!inner || inner.endsWith('?')) continue;
    if (!isStateReference(inner) || allowed.has(inner)) continue;
    findings.push({
      level: 'error',
      rule: 'brace-state-key',
      line: lineAt(match.index),
      text: match[0],
      message: `The runtime reads ${match[0]} as a session-state key; when the key is absent it becomes an empty string, silently removing this text.`,
      fix: `Use the optional form {${inner}?} if this is another agent's output_key, otherwise write <${inner}> or plain words.`,
    });
  }

  for (const [label, pattern] of SECRET_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    findings.push({
      level: 'error',
      rule: 'plaintext-secret',
      line: lineAt(match.index),
      text: `${match[0].slice(0, 8)}…`,
      message: `${label} in instruction text. Instructions are sent to the model on every call.`,
      fix: 'Register the value as an organization secret and reference it as {cred:NAME} in a custom API config.',
    });
  }

  for (const match of text.matchAll(/\{([\p{L}_][\p{L}\p{N}_]*)\?\}/gu)) {
    if (allowed.has(match[1])) continue;
    findings.push({
      level: 'note',
      rule: 'optional-key',
      line: lineAt(match.index),
      text: match[0],
      message: `Resolves to an empty string unless an earlier agent in the same run wrote output_key "${match[1]}".`,
      fix: 'Confirm the producer runs first, and tell the agent what to do when the value is empty.',
    });
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    errors: findings.filter((finding) => finding.level === 'error').length,
    findings,
  };
}
