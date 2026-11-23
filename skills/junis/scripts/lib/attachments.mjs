// Files sent along with a run: local paths are read here and travel with the
// message as multipart parts (the platform stores them and attaches their
// links); links to files that are already online go into the request as they are.
import fs from 'node:fs';
import path from 'node:path';
import { KitError } from './http.mjs';

export const MAX_ATTACHMENTS = 5; // the platform accepts at most five files per message

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
    const full = path.resolve(entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      throw usage(`File not found: ${entry}`, 'Pass the path of a file on this machine. For a file that is already online, use file_urls.');
    }
    if (!stat.isFile()) throw usage(`Not a file: ${entry}`, 'Attach files one by one; a folder cannot be sent.');
    if (stat.size === 0) throw usage(`The file is empty: ${entry}`);
    read.push({ name: path.basename(full), type: TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', data: fs.readFileSync(full) });
  }
  return { files: read, urls };
}
