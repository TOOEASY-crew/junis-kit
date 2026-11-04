// Reading and editing agent config files without damaging them.
//
// Several agents accept comments and trailing commas in their config. Such a
// file can be read here, but it is never rewritten: serialising it back would
// silently delete the user's comments. The caller reports a manual step.
import fs from 'node:fs';
import path from 'node:path';

// Walk the text once, copying string literals untouched so that "//" or ",}"
// inside a value is never mistaken for a comment or a trailing comma.
function transformOutsideStrings(text, handle) {
  let out = '';
  let changed = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const step = handle(text, i);
    if (step) {
      changed = true;
      out += step.emit;
      i = step.next;
    } else {
      out += char;
      i += 1;
    }
  }
  return { text: out, changed };
}

export function stripJsonComments(text) {
  const comments = transformOutsideStrings(text, (source, i) => {
    if (source[i] !== '/') return null;
    if (source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      return { emit: '', next: end === -1 ? source.length : end };
    }
    if (source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      return { emit: '', next: end === -1 ? source.length : end + 2 };
    }
    return null;
  });
  const commas = transformOutsideStrings(comments.text, (source, i) => {
    if (source[i] !== ',') return null;
    const rest = /^\s*[}\]]/.exec(source.slice(i + 1));
    return rest ? { emit: '', next: i + 1 } : null;
  });
  return { text: commas.text, changed: comments.changed || commas.changed };
}

export function readConfig(file) {
  if (!fs.existsSync(file)) return { state: 'missing', data: {}, indent: 2 };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return { state: 'empty', data: {}, indent: 2 };
  const indentMatch = /^([ \t]+)"/m.exec(raw);
  const indent = indentMatch ? (indentMatch[1].includes('\t') ? '\t' : indentMatch[1].length) : 2;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'invalid', data: {}, indent };
    return { state: 'json', data, indent };
  } catch {
    // fall through to the tolerant reader
  }
  try {
    const data = JSON.parse(stripJsonComments(raw).text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'invalid', data: {}, indent };
    return { state: 'jsonc', data, indent };
  } catch {
    return { state: 'invalid', data: {}, indent };
  }
}

// Agent config files often hold other servers' tokens, so the copy is
// owner-only whatever the original's mode was.
export function backupFile(file, stamp) {
  const backup = `${file}.junis-kit-backup-${stamp}`;
  fs.copyFileSync(file, backup);
  fs.chmodSync(backup, 0o600);
  return backup;
}

// Written through a temp file and a rename, at the real location so a
// symlinked config (dotfiles setups) keeps being a symlink.
export function writeConfig(file, data, indent = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, indent)}\n`, { mode });
  fs.renameSync(tmp, target);
}

export function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}
