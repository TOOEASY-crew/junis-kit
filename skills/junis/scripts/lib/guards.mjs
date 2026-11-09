// Text fields whose empty value erases something on Junis. Checked before any write leaves
// the kit, on every path that can carry one: `api`, `tools call` and the MCP bridge
// (junis_api, junis_call_tool). The usual way an empty value gets here is `instruction=@file`
// with a file that was never written.
import { KitError } from './http.mjs';

const ERASING_FIELDS = [
  ['instruction', "the agent's instruction"],
  ['content', 'the page content'],
];

// A KitError when `body` sets one of the fields to an empty (or whitespace-only) string; null otherwise.
export function emptyTextFieldError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const [field, what] of ERASING_FIELDS) {
    if (typeof body[field] === 'string' && body[field].trim() === '') {
      return new KitError(`The body sets "${field}" to an empty string, which would erase ${what}.`, {
        code: `empty_${field}`,
        hint: 'Send the full text, or remove the key to keep the current one. Nothing was sent.',
      });
    }
  }
  return null;
}
