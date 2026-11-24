// Files sent along with a run: local paths are read here and travel with the
// message as multipart parts (the platform stores them and attaches their
// links); links to files that are already online go into the request as they are.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kitHome } from './config.mjs';
import { KitError } from './http.mjs';

export const MAX_ATTACHMENTS = 5; // the platform accepts at most five files per message
// The platform refuses a document over 100 MB and a media file over 200 MB, and the whole request over 250 MB.
// Checked before the file is read: an oversized file is refused here instead of being loaded into memory first.
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

// Places that hold keys and credentials. A file from here is never sent: attachments are stored by the platform
// under a link, and `files` is an argument a model fills in. The kit's own home holds the API key.
function secretRoots() {
  const home = os.homedir();
  return [kitHome(), ...['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', '.azure', '.claude', '.netrc', '.npmrc', '.pypirc', '.git-credentials']
    .map((name) => path.join(home, name))];
}

function real(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function insideSecretRoot(full) {
  return secretRoots().some((root) => {
    const base = real(root);
    return full === base || full.startsWith(base + path.sep);
  });
}

// Enough for the platform to tell a text file from an image or a document; anything else is sent as bytes.
const TYPES = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.webm': 'video/webm',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

// A list given as an array (tool argument) or as comma-separated text (command line flag).
export function listOf(value) {
  if (value === undefined || value === null || value === '' || value === true) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((item) => (typeof item === 'string' ? item.trim() : item)).filter((item) => item !== '');
}

function usage(message, hint) {
  return new KitError(message, { code: 'usage', hint });
}

// -> { files: [{ name, type, data }], urls: [string] }. Throws before anything is sent.
export function readAttachments({ files, file_urls: fileUrls } = {}) {
  const paths = listOf(files);
  const urls = listOf(fileUrls);
  if (paths.length + urls.length > MAX_ATTACHMENTS) {
    throw usage(`At most ${MAX_ATTACHMENTS} attachments per message (files and file_urls together), got ${paths.length + urls.length}`);
  }
  for (const url of urls) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw usage(`file_urls takes http(s) links, got ${String(url).slice(0, 60)}`, 'For a file on this machine, pass its path in files instead.');
    }
  }
  const read = [];
  for (const entry of paths) {
    if (typeof entry !== 'string') throw usage('files takes paths to files on this machine');
    let full;
    let stat;
    try {
      // The real location, with symbolic links followed: a link named notes.txt that points at a key file is that key file.
      full = fs.realpathSync(path.resolve(entry));
      stat = fs.statSync(full);
    } catch {
      throw usage(`File not found: ${entry}`, 'Pass the path of a file on this machine. For a file that is already online, use file_urls.');
    }
    if (!stat.isFile()) throw usage(`Not a file: ${entry}`, 'Attach files one by one; a folder cannot be sent.');
    if (insideSecretRoot(full)) {
      throw usage(`Refusing to send a file from a credentials folder: ${entry}`, 'Files under the kit home, ~/.ssh, ~/.aws and similar folders hold keys and are never attached. Copy the content you mean to share to another place first.');
    }
    if (stat.size === 0) throw usage(`The file is empty: ${entry}`);
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      throw usage(`The file is too large to attach (${Math.ceil(stat.size / 1024 / 1024)} MB): ${entry}`, 'The platform takes documents up to 100 MB and media files up to 200 MB. Put a larger file online and pass its link in file_urls.');
    }
    // The name the caller wrote is what the agent sees; the bytes come from the real location.
    read.push({ name: path.basename(path.resolve(entry)), type: TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', data: fs.readFileSync(full) });
  }
  return { files: read, urls };
}

// What was sent, for the run result: names and sizes only.
export function attachedSummary(attachments) {
  const files = (attachments?.files || []).map((file) => ({ name: file.name, bytes: file.data?.length ?? 0 }));
  const urls = (attachments?.urls || []).map((url) => ({ url }));
  return files.length || urls.length ? [...files, ...urls] : undefined;
}
