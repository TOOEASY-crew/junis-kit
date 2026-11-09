// Turn platform errors into the one next action that resolves them. Kept in
// its own module so the API client and the kit tools can both use it without
// importing each other.
import { loginUrl, resolveProfile } from './config.mjs';

export function classifyToolError(message) {
  const text = String(message || '');
  if (/insufficient_scopes/i.test(text)) return 'insufficient_scopes';
  if (/No organization specified|organization_required/i.test(text)) return 'no_organization';
  if (/subscription_required|no_subscription|invalid_plan|subscription required/i.test(text)) return 'subscription_required';
  if (/insufficient_credits|\b402\b/i.test(text)) return 'payment_required';
  if (/No API key found|\b401\b|invalid or expired api key/i.test(text)) return 'unauthorized';
  if (/\b403\b/.test(text)) return 'forbidden';
  if (/\b404\b/.test(text)) return 'not_found';
  if (/\b409\b/.test(text)) return 'conflict';
  if (/\b422\b/.test(text)) return 'invalid_request';
  if (/\b429\b|rate_limit/i.test(text)) return 'rate_limited';
  return 'tool_error';
}

// Turn a platform error into the one next action that resolves it. Accepts
// either an error message or a parsed error body.
export function explainError(error, profile = resolveProfile()) {
  const text = typeof error === 'string' ? error : JSON.stringify(error ?? '');
  const code = classifyToolError(text);
  // Only well-formed scope names are repeated back; the hint is shown to the
  // model, so nothing else from the error body may be interpolated.
  // The hosted server relays the body as a Python repr ('…'), the API as JSON ("…").
  const missing = (/["']missing_scopes["']\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] || '')
    .split(',')
    .map((scope) => scope.replace(/["'\s]/g, ''))
    .filter((scope) => /^[a-z_]+:[a-z_*]+$/.test(scope))
    .join(', ');
  const hints = {
    insufficient_scopes: `The key lacks a permission${missing ? ` (${missing})` : ''}. The user adds it to the existing key with "Add permissions" at ${loginUrl(profile)}, or runs the browser login again (junis_connect with method "browser"), which requests every permission the kit uses that this platform offers (a key made before the platform had a permission, such as the Actions ones, lacks it until then). Only an organization key (jns_live_) cannot be extended: the user creates a new key with the permission ticked and connects again.`,
    no_organization: 'No organization was named and the account has no default. Pass organization_id (a UUID from list_organizations).',
    subscription_required: `The account has no active Basic or Pro plan, which every API call requires. The user subscribes at ${profile.web_url}/subscription.`,
    payment_required: `The paying balance is out of credits. Credits are bought at ${profile.web_url}/subscription. If the message says organization credits or billing_role is "member", the organization owner pays and adds them. Schedules stopped for this reason must be enabled again afterwards.`,
    unauthorized: `The key was rejected. The user copies a current key at ${loginUrl(profile)} and connects again.`,
    forbidden: 'Check three things in this order: organization_id is a UUID this key can reach (list_organizations), the account role there is OWNER or ADMIN, and the resource belongs to that organization.',
    not_found: 'Ids belong to one organization. List the resources in the target organization and use the id from that response.',
    conflict: 'The resource already exists, is in use, or the text to replace matched zero or several times. Read the current state, then retry with exact values.',
    invalid_request: 'A field failed validation; the message names it. Check the tool schema with describe before retrying.',
    rate_limited: 'Limits: 100 calls a minute per key (2,000 an hour for a personal key, 3,000 for an organization key) and 300 a minute per organization. Wait the Retry-After time; do not retry in a loop.',
  };
  return { code, hint: hints[code] || '' };
}
