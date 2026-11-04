#!/usr/bin/env node
// Every agent ecosystem wants its own manifest. They are all generated from
// kit.json so that name, version and description cannot drift apart.
//
//   node scripts/build-manifests.mjs                       write the files
//   node scripts/build-manifests.mjs --check               exit 1 if any file is out of date
//   node scripts/build-manifests.mjs --set-version 0.2.0   change every version, then write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

// Files that carry the version but are written by hand.
const versioned = [
  ['package.json', /"version": "([^"]+)"/],
  ['skills/junis/scripts/lib/config.mjs', /KIT_VERSION = '([^']+)'/],
  ['skills/junis/SKILL.md', /version: "([^"]+)"/],
];

const setAt = args.indexOf('--set-version');
if (setAt !== -1) {
  const next = args[setAt + 1] || '';
  if (args.includes('--check')) {
    console.error('--set-version writes files; run --check on its own afterwards');
    process.exit(1);
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(next)) {
    console.error('--set-version needs a version such as 0.2.0');
    process.exit(1);
  }
  // Read and check every file first, so a miss leaves nothing half-changed.
  const edits = [];
  for (const [relative, pattern] of [['kit.json', /"version": "([^"]+)"/], ...versioned]) {
    const file = path.join(root, relative);
    const text = fs.readFileSync(file, 'utf8');
    if (!pattern.test(text)) {
      console.error(`${relative} has no version to change; nothing was changed`);
      process.exit(1);
    }
    try {
      fs.accessSync(file, fs.constants.W_OK);
    } catch {
      console.error(`${relative} is not writable; nothing was changed`);
      process.exit(1);
    }
    edits.push([relative, file, text.replace(pattern, (match, old) => match.replace(old, next))]);
  }
  for (const [relative, file, text] of edits) {
    fs.writeFileSync(file, text);
    console.log(`set ${relative} to ${next}`);
  }
}

const kit = JSON.parse(fs.readFileSync(path.join(root, 'kit.json'), 'utf8'));
const script = 'skills/junis/scripts/junis.mjs';

const base = {
  name: kit.name,
  version: kit.version,
  description: kit.description,
  author: kit.author,
  homepage: kit.homepage,
  license: kit.license,
  keywords: kit.keywords,
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Claude Code gets no version on purpose: it skips `claude plugin update` while the
// manifest version string is unchanged, and without one it uses the commit SHA of a
// git-hosted marketplace, so every push to main reaches users the same way install.sh
// does (code.claude.com/docs/en/plugins/loading, "Versions and updates").
const { version: _claudeUsesCommit, ...unversioned } = base;

const files = {
  '.claude-plugin/plugin.json': json({ name: kit.name, displayName: kit.displayName, ...unversioned }),
  '.claude-plugin/marketplace.json': json({
    name: kit.marketplace,
    description: kit.marketplaceDescription,
    owner: { name: kit.author.name, email: kit.author.email },
    plugins: [{ name: kit.name, source: './', description: kit.shortDescription, category: kit.category }],
  }),
  // Claude Code: full catalogue, because it loads tool schemas on demand.
  '.mcp.json': json({
    mcpServers: { [kit.name]: { command: 'node', args: [`\${CLAUDE_PLUGIN_ROOT}/${script}`, 'mcp'] } },
  }),
  // Agent Plugins 1.0 (Codex, VS Code, Cursor): a few discovery tools, because
  // these clients load every tool schema up front.
  // OpenAI reads its own presentation data from extensions["com.openai"].
  'plugin.json': json({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    ...base,
    extensions: {
      'com.openai': {
        interface: {
          displayName: kit.displayName,
          shortDescription: kit.shortDescription,
          developerName: kit.author.name,
          category: 'Productivity',
          defaultPrompt: kit.prompts,
        },
      },
    },
  }),
  'mcp.json': json({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { [kit.name]: { type: 'stdio', command: 'node', args: [`\${PLUGIN_ROOT}/${script}`, 'mcp', '--lazy'] } },
  }),
  '.codex-plugin/plugin.json': json({
    ...base,
    skills: './skills/',
    mcpServers: './mcp.json',
    interface: {
      displayName: kit.displayName,
      shortDescription: kit.shortDescription,
      longDescription: kit.description,
      developerName: kit.author.name,
      category: 'Productivity',
      capabilities: ['Interactive', 'Read', 'Write'],
      websiteURL: kit.homepage,
      defaultPrompt: kit.prompts,
    },
  }),
  '.agents/plugins/marketplace.json': json({
    name: kit.marketplace,
    interface: { displayName: `${kit.displayName} kit` },
    plugins: [{ name: kit.name, source: './', policy: { installation: 'AVAILABLE' }, category: 'Productivity' }],
  }),
  // Cursor does not expand ${PLUGIN_ROOT}; it has its own variable.
  '.cursor-plugin/plugin.json': json({ ...base, displayName: kit.displayName, skills: './skills/', mcpServers: './.cursor-plugin/mcp.json' }),
  '.cursor-plugin/mcp.json': json({
    mcpServers: { [kit.name]: { type: 'stdio', command: 'node', args: [`\${CURSOR_PLUGIN_ROOT}/${script}`, 'mcp', '--lazy'] } },
  }),
  // Skill-only installs (npx skills add, a copied folder, the Claude Desktop ZIP)
  // ship just skills/junis, and Apache-2.0 asks that the license travel with it.
  'skills/junis/LICENSE.txt': fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
  'skills/junis/NOTICE.txt': fs.readFileSync(path.join(root, 'NOTICE'), 'utf8'),
  'gemini-extension.json': json({
    name: kit.name,
    version: kit.version,
    description: kit.description,
    mcpServers: { [kit.name]: { command: 'node', args: [`\${extensionPath}\${/}skills\${/}junis\${/}scripts\${/}junis.mjs`, 'mcp', '--lazy'] } },
    contextFileName: 'GEMINI.md',
  }),
};

const check = args.includes('--check');
const problems = [];

for (const [relative, content] of Object.entries(files)) {
  const file = path.join(root, relative);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === content) continue;
  if (check) {
    problems.push(`${relative} is out of date`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`wrote ${relative}`);
  }
}

for (const [relative, pattern] of versioned) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    problems.push(`${relative} is missing`);
    continue;
  }
  const found = pattern.exec(fs.readFileSync(file, 'utf8'))?.[1];
  if (found !== kit.version) problems.push(`${relative} has version ${found}, kit.json has ${kit.version}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(check ? 'manifests are in sync' : 'done');
