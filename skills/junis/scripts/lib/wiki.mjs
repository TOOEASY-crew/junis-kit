// Wiki pages by file key: read, replace with a local backup, append.
//
// A plain `api PUT /management/wiki/content` sends whatever body it is given; a `content=@file`
// whose file is empty, or a JSON body with `"content": ""`, stores an empty page.
// `wiki put` refuses an empty body, saves the
// current page under the kit home, writes with the version it read (the platform answers 409
// if the page changed in between), then reads the page back and compares before reporting
// success. Known limit: a page that does not exist yet is created without a version check, so
// two first writers racing for the same key are not detected.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readStdin } from './args.mjs';
import { kitHome } from './config.mjs';
import { KitError } from './http.mjs';
import { timestamp } from './jsonc.mjs';
import { callApi } from './kit-tools.mjs';

const PAGE = '/management/wiki/content';
const APPEND = '/management/wiki/content/append';
const USAGE = 'Usage: wiki get <file_key> [--out path] | wiki put <file_key> --file path|--text=s [--annotation s] [--summary s] [--min-chars n] [--yes] | wiki append <file_key> --file path|--text=s';

// The platform may normalise trailing whitespace; the comparison ignores it on both sides.
export function sha256Stripped(text) {
  return crypto.createHash('sha256').update(String(text ?? '').trim(), 'utf8').digest('hex');
}

function bodyFrom(flags) {
  const hasText = flags.text !== undefined;
  const hasFile = flags.file !== undefined;
  if (hasText && hasFile) throw new KitError('Pass either --file or --text, not both.', { code: 'usage', hint: USAGE });
  if (hasText) {
    if (typeof flags.text !== 'string') throw new KitError('--text needs a value; write it as --text=<string> when it starts with "-".', { code: 'usage', hint: USAGE });
    return flags.text;
  }
  if (typeof flags.file !== 'string') throw new KitError(USAGE, { code: 'usage' });
  if (flags.file === '-') return readStdin();
  if (!fs.existsSync(flags.file)) throw new KitError(`File not found: ${flags.file}`, { code: 'file_not_found', hint: 'Nothing was sent.' });
  return fs.readFileSync(flags.file, 'utf8');
}

function minCharsFrom(flags) {
  if (flags.min_chars === undefined) return 1;
  const value = Number(flags.min_chars);
  if (!Number.isInteger(value) || value < 1) {
    throw new KitError(`--min-chars must be a positive integer, got ${JSON.stringify(flags.min_chars)}.`, { code: 'usage' });
  }
  return value;
}

function requireBody(text, minChars) {
  const chars = String(text ?? '').trim().length;
  if (chars === 0) {
    throw new KitError('The body is empty; nothing was sent.', {
      code: 'empty_body',
      hint: 'An empty write would erase the page. Check the file that was meant to hold the content.',
    });
  }
  if (chars < minChars) {
    throw new KitError(`The body has ${chars} characters, fewer than --min-chars ${minChars}; nothing was sent.`, { code: 'body_too_short' });
  }
}

async function readPage(fileKey) {
  try {
    return await callApi({ method: 'GET', path: PAGE, query: { file_key: fileKey } });
  } catch (err) {
    if (err instanceof KitError && err.status === 404) return null;
    throw err;
  }
}

// One file per write, never overwritten: the second write in the same second must not replace the backup of the first.
function saveBackup(fileKey, page) {
  const dir = path.join(kitHome(), 'backups', 'wiki');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const slug = fileKey.replace(/[^A-Za-z0-9._-]+/g, '_');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const file = path.join(dir, `${timestamp()}_${process.pid}_${crypto.randomBytes(3).toString('hex')}_${slug}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(page, null, 2), { mode: 0o600, flag: 'wx' });
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new KitError('Could not create a unique backup file under the kit home.', { code: 'backup_failed' });
}

// Same rule as the CLI's requireYes: a person at a terminal typed it; an agent must have asked and says so with --yes.
function confirmReplace(fileKey, flags) {
  if (flags.yes || process.stdin.isTTY) return;
  throw new KitError(`wiki put replaces the page '${fileKey}' on Junis.`, {
    code: 'needs_confirmation',
    hint: 'Tell the user which page will be replaced and ask. Only if they agree, run the same command again with --yes. The current page is saved under the kit home before the write.',
  });
}

export async function wikiGet(fileKey, { out } = {}) {
  const page = await readPage(fileKey);
  if (!page) throw new KitError(`No wiki page '${fileKey}'`, { code: 'not_found', status: 404 });
  const content = String(page.content ?? '');
  const summary = { file_key: fileKey, version: page.version ?? null, chars: content.length, sha256: sha256Stripped(content) };
  if (out) {
    fs.writeFileSync(out, content, { mode: 0o600 });
    return { ...summary, written_to: out };
  }
  return { ...summary, content };
}

export async function wikiPut(fileKey, flags) {
  const body = bodyFrom(flags);
  requireBody(body, minCharsFrom(flags));
  const current = await readPage(fileKey);
  let backup = null;
  if (current) {
    confirmReplace(fileKey, flags);
    backup = saveBackup(fileKey, current);
  }
  const payload = {
    file_key: fileKey,
    content: body,
    annotation: typeof flags.annotation === 'string' ? flags.annotation : current?.annotation ?? '',
    ...(typeof flags.summary === 'string' ? { summary: flags.summary } : {}),
    ...(current && current.version !== undefined ? { expected_version: current.version } : {}),
  };
  let written;
  try {
    written = await callApi({ method: 'PUT', path: PAGE, body: payload });
  } catch (err) {
    if (err instanceof KitError && err.status === 409) {
      throw new KitError(`The page '${fileKey}' changed after it was read (version ${current?.version ?? '?'}); nothing was replaced.`, {
        code: 'conflict',
        status: 409,
        detail: { read_version: current?.version ?? null, backup },
        hint: `Run \`wiki get ${fileKey}\` to see the new content, merge, and run wiki put again.${backup ? ` The content read before this attempt is saved at ${backup}.` : ''}`,
      });
    }
    throw err;
  }
  const after = await readPage(fileKey);
  const expected = sha256Stripped(body);
  const actual = sha256Stripped(after?.content ?? '');
  if (!after || actual !== expected) {
    throw new KitError(`The page '${fileKey}' read back differs from what was sent.`, {
      code: 'verify_failed',
      detail: { expected_sha256: expected, actual_sha256: after ? actual : null, read_back: after ? 'different' : 'missing', backup },
      hint: backup ? `The previous content is saved at ${backup}.` : 'The page was new; nothing to restore.',
    });
  }
  return { file_key: fileKey, created: !current, version: after.version ?? written?.version ?? null, chars: body.length, sha256: expected, backup };
}

export async function wikiAppend(fileKey, flags) {
  const body = bodyFrom(flags);
  requireBody(body, 1);
  const result = await callApi({ method: 'POST', path: APPEND, body: { file_key: fileKey, content: body } });
  return {
    file_key: fileKey,
    appended_chars: body.length,
    version: result?.version ?? null,
    ...(result?.archived_to ? { archived_to: result.archived_to } : {}),
  };
}

export async function commandWiki({ positionals, flags }) {
  const [action, fileKey] = positionals;
  if (!action || !fileKey) throw new KitError(USAGE, { code: 'usage' });
  if (action === 'get') return wikiGet(fileKey, { out: typeof flags.out === 'string' ? flags.out : undefined });
  if (action === 'put') return wikiPut(fileKey, flags);
  if (action === 'append') return wikiAppend(fileKey, flags);
  throw new KitError(`Unknown wiki action "${action}". ${USAGE}`, { code: 'usage' });
}
