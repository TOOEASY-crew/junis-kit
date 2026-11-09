// Small argument parser: `--flag`, `--key value`, `--key=value`, `key=value`
// pairs and positionals. No dependency keeps the skill self-contained.
import fs from 'node:fs';
import { KitError, parseJsonSafe } from './http.mjs';

// Flags that never take a value. Shared by the CLI and the confirmation hook,
// so the hook reads a command line exactly as the CLI will.
export const BOOLEAN_FLAGS = [
  'help', 'version', 'pretty', 'offline', 'from_clipboard', 'key_stdin', 'from_env', 'keep_clipboard',
  'dry_run', 'lazy', 'full', 'all', 'force', 'no_wait', 'no_cli', 'purge', 'yes',
];

// A word as it must be typed in a shell command (a profile name with a space or a quote).
export function shellWord(value) {
  const text = String(value);
  return /^[\w.@%+=:,/-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

// `--query "a=1&b=2"` for the api command.
export function parseQuery(value) {
  const query = {};
  if (typeof value !== 'string') return query;
  for (const part of value.split(/[&,]/)) {
    const eq = part.indexOf('=');
    if (eq > 0) query[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return query;
}

// Splits a shell command line into words the way a POSIX shell would for
// plain commands: quotes, backslash escapes, the operators ; && || | & ( ) as
// separate words, redirections dropped with their targets and heredoc bodies
// skipped. Variables and substitutions are left as written.
export function splitShellWords(line) {
  // Blanks are space and tab only (a no-break space stays inside a word, as in the
  // shell); `#` at a word start is a comment; backslash-newline is removed; ( ) and
  // redirections are operators, and a redirection swallows its target word; heredoc
  // bodies are skipped; $'...' is a quote.
  const words = [];
  let word = '';
  let inWord = false;
  let quote = '';
  let skipNext = false; // the target word of a redirection
  const heredocs = [];
  const text = String(line || '');
  const push = () => {
    if (inWord) {
      if (skipNext) skipNext = false;
      else words.push(word);
    }
    word = '';
    inWord = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = '';
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = '';
      else if (ch === '\\' && text[i + 1] === '\n') i += 1;
      else if (ch === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) word += text[(i += 1)];
      else word += ch;
      continue;
    }
    if (ch === '$' && text[i + 1] === "'") { quote = "'"; inWord = true; i += 1; continue; }
    if (ch === "'" || ch === '"') { quote = ch; inWord = true; continue; }
    if (ch === '\\' && text[i + 1] === '\n') { i += 1; continue; }
    if (ch === '\\' && i + 1 < text.length) { word += text[(i += 1)]; inWord = true; continue; }
    if (ch === '#' && !inWord) { while (i + 1 < text.length && text[i + 1] !== '\n') i += 1; continue; }
    if (ch === '<' || ch === '>') {
      if (/^\d*$/.test(word) && inWord) { word = ''; inWord = false; } // 2> : fd number belongs to the redirection
      push();
      // The operator: < > << >> <<< <<- and the forms with & or | after it (>& <& >|).
      let op = ch;
      if (text[i + 1] === ch) op += text[(i += 1)];
      if (op === '<<' && text[i + 1] === '<') op += text[(i += 1)];
      else if (op === '<<' && text[i + 1] === '-') op += text[(i += 1)];
      else if (op.length === 1 && (text[i + 1] === '&' || (ch === '>' && text[i + 1] === '|'))) op += text[(i += 1)];
      if (op.startsWith('<<') && op !== '<<<') {
        // heredoc: read the delimiter word, skip the body at the next newline
        let j = i + 1;
        while (text[j] === ' ' || text[j] === '\t') j += 1;
        let delim = '';
        while (j < text.length && !/[\s;&|<>()]/.test(text[j])) { if (!`'"\\`.includes(text[j])) delim += text[j]; j += 1; }
        heredocs.push({ delim, strip: op === '<<-' });
        i = j - 1;
        continue;
      }
      if (op.endsWith('&')) {
        // >&2, 2>&1, <&-: the target is a descriptor; >&file sends both streams to a file
        if (/[\d-]/.test(text[i + 1] || '')) {
          while (/\d/.test(text[i + 1] || '')) i += 1;
          if (text[i + 1] === '-') i += 1;
          continue;
        }
      }
      skipNext = true;
      continue;
    }
    if (ch === '&' && text[i + 1] === '>') { push(); i += 1; if (text[i + 1] === '>') i += 1; skipNext = true; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ';&|()'.includes(ch)) {
      push();
      if (ch === '\n' || ';&|()'.includes(ch)) {
        const op = ';&|'.includes(ch) && text[i + 1] === ch ? ch + text[(i += 1)] : ch === '\n' ? ';' : ch;
        words.push({ op });
      }
      if (ch === '\n' && heredocs.length) {
        for (const { delim, strip } of heredocs.splice(0)) {
          for (;;) {
            const nl = text.indexOf('\n', i + 1);
            const lineText = text.slice(i + 1, nl === -1 ? text.length : nl);
            i = nl === -1 ? text.length : nl;
            if ((strip ? lineText.replace(/^\t+/, '') : lineText) === delim || nl === -1) break;
          }
        }
      }
      continue;
    }
    word += ch;
    inWord = true;
  }
  if (quote) return null;
  push();
  return words;
}

// `pairs: false` keeps `key=value` tokens as positionals, for commands whose
// positional text is free prose (a message such as "KPI=매출 요약해줘").
export function parseArgs(argv, { booleans = [], pairs: wantPairs = true } = {}) {
  const flags = {};
  const positionals = [];
  const pairs = {};
  const booleanSet = new Set(booleans);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).replace(/-/g, '_');
      if (eq !== -1) {
        flags[name] = arg.slice(eq + 1);
      } else if (booleanSet.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        flags[name] = true;
      } else {
        flags[name] = argv[i + 1];
        i += 1;
      }
      continue;
    }
    const pair = wantPairs ? /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(arg) : null;
    if (pair) pairs[pair[1]] = coerce(pair[2]);
    else positionals.push(arg);
  }
  return { flags, positionals, pairs };
}

// key=value pairs are convenient for simple calls; values that parse as JSON
// (numbers, booleans, arrays, objects) are passed typed, the rest as strings.
function coerce(value) {
  if (value === '') return '';
  const parsed = parseJsonSafe(value);
  if (parsed !== undefined && (typeof parsed !== 'number' || String(parsed) === value)) return parsed;
  return value;
}

export function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Resolve a JSON payload from --json, --file, stdin ("-") or key=value pairs.
export function resolvePayload({ flags, pairs }) {
  let source;
  if (typeof flags.json === 'string') source = flags.json === '-' ? readStdin() : flags.json;
  else if (typeof flags.file === 'string') {
    if (flags.file !== '-' && !fs.existsSync(flags.file)) {
      throw new KitError(`File not found: ${flags.file}`, { code: 'file_not_found', hint: 'Nothing was sent. Check the path of the payload file.' });
    }
    source = flags.file === '-' ? readStdin() : fs.readFileSync(flags.file, 'utf8');
    if (!source.trim()) {
      throw new KitError(`The payload file is empty: ${flags.file}`, { code: 'empty_payload', hint: 'Nothing was sent. The step that should have written the file probably failed.' });
    }
  }
  if (source === undefined) return Object.keys(pairs).length ? pairs : undefined;
  const parsed = parseJsonSafe(source);
  if (parsed === undefined) {
    throw new KitError('The payload is not valid JSON', {
      code: 'bad_json',
      hint: 'Write the JSON to a file and pass --file <path>; that avoids shell quoting problems.',
    });
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...parsed, ...pairs };
  return parsed;
}

// Text arguments such as instructions are long and full of quotes and braces.
// `name=@path` reads the value from a file so it never passes through the shell.
//
// `@base64:path` reads a file as base64, the form document uploads need
// (`{"filename": "manual.pdf", "content": "@base64:./manual.pdf"}`). It is also
// honoured inside nested objects and lists, where plain `@path` is not.
// Larger than any upload the platform accepts (Knowledge 20 MB a file, RAG and
// skills 10 MB): refuse before reading the file into memory.
const MAX_BASE64_BYTES = 50 * 1024 * 1024;

function readBase64(file, key) {
  if (!fs.existsSync(file)) throw new KitError(`File not found for ${key}: ${file}`, { code: 'file_not_found' });
  const size = fs.statSync(file).size;
  if (size > MAX_BASE64_BYTES) {
    throw new KitError(`File too large for ${key}: ${file} (${Math.round(size / 1024 / 1024)} MB)`, {
      code: 'file_too_large',
      hint: 'Uploads through the API take up to 20 MB a file (Knowledge) or 10 MB (RAG, skills). Split the file, or upload it in the web app.',
    });
  }
  return fs.readFileSync(file).toString('base64');
}

function expandNested(value, key) {
  if (typeof value === 'string' && value.startsWith('@base64:') && value.length > 8) return readBase64(value.slice(8), key);
  if (typeof value === 'string' && value.startsWith('@env:') && value.length > 5) return readEnvReference(value.slice(5), key);
  if (Array.isArray(value)) return value.map((item) => expandNested(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, expandNested(item, name)]));
  }
  return value;
}

// `@env:NAME` substitutes an environment variable so a secret (database password, API key) never appears in the
// conversation or the model's context: `{"password": "@env:DB_PASSWORD"}`.
export function readEnvReference(name, key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new KitError(`Invalid environment variable name for ${key}: ${name}`, { code: 'bad_env_reference', hint: 'Use @env:UPPER_SNAKE_CASE.' });
  }
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new KitError(`Environment variable not set for ${key}: ${name}`, { code: 'env_not_set', hint: `export ${name}=… in the shell that runs the kit, then retry.` });
  }
  return value;
}

export function expandFileReferences(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.startsWith('@base64:') && value.length > 8) {
      out[key] = readBase64(value.slice(8), key);
    } else if (typeof value === 'string' && value.startsWith('@env:') && value.length > 5) {
      out[key] = readEnvReference(value.slice(5), key);
    } else if (value && typeof value === 'object') {
      out[key] = expandNested(value, key);
    } else if (typeof value === 'string' && value.startsWith('@') && value.length > 1) {
      const file = value.slice(1);
      if (fs.existsSync(file)) {
        out[key] = fs.readFileSync(file, 'utf8');
      } else if (/[/\\.]/.test(file)) {
        // Looks like a path: a typo must not silently become the literal text.
        throw new KitError(`File not found for ${key}: ${file}`, { code: 'file_not_found', hint: 'To pass a literal value that starts with "@", put it in --json.' });
      } else {
        // A handle such as @channel is a value, not a file.
        out[key] = value;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}
