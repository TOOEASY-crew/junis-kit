// The personal-assistant example is the page people copy. These tests RUN its script (no browser, no packages):
// a small stand-in for the DOM and for fetch, then the same clicks and submits a person makes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(REPO, 'examples', 'personal-assistant', 'index.html'), 'utf8');
const SCRIPT = HTML.slice(HTML.indexOf('<script>') + 8, HTML.lastIndexOf('</script>'));

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this._text = ''; this._value = ''; this.files = []; this.dataset = {}; this.style = {}; this.className = ''; this.listeners = {}; this.scrollTop = 0; this.scrollHeight = 0; }
  get value() { return this._value; }
  set value(v) { this._value = v; if (v === '') this.files = []; }       // clearing a file input empties its file list
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  prepend(...nodes) { for (const n of nodes.reverse()) { n.parent = this; this.children.unshift(n); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  find(pred) { for (const c of this.children) { if (pred(c)) return c; const d = c.find(pred); if (d) return d; } return null; }
}

// One open chat reply the test controls: push stream lines, then end it.
function openReply() {
  const waiting = []; const chunks = []; let ended = false; let failed = null;
  const feed = () => {
    while (waiting.length && (chunks.length || ended || failed)) {
      const w = waiting.shift();
      if (chunks.length) w.resolve({ value: chunks.shift(), done: false }); else if (failed) w.reject(failed); else w.resolve({ value: undefined, done: true });
    }
  };
  return {
    reader: { read: () => new Promise((resolve, reject) => { waiting.push({ resolve, reject }); feed(); }) },
    say(obj) { chunks.push(new TextEncoder().encode('data: ' + JSON.stringify(obj) + '\n\n')); feed(); },
    end() { ended = true; feed(); },
    fail(err) { failed = err || new Error('network error'); feed(); },
  };
}

function boot({ chatStatus = () => 200, connections = { all_connected: false, items: [] }, feedItems = [] } = {}) {
  const made = {}; const chats = []; const timers = []; const requests = []; const opened = []; const uploads = [];
  const signIn = { opened: [], polls: 0, activeFor: 2, refuse: 0 }; const tabs = [];
  const rooms = { posts: [], refuse: 0 };
  const document = { getElementById: (id) => (made[id] ||= new El(id)), createElement: (tag) => new El(tag) };
  const els = new Proxy({}, { get: (_, id) => document.getElementById(id) });       // the page asks for an element the first time it needs it
  const json = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET';
    requests.push(method + ' ' + u.replace(/^https:\/\/api\.junis\.ai\/api\/external/, ''));
    if (u === '/api/junis-token') return json(200, { token: 'a.b.c', expires_in: 600 });
    if (u.endsWith('/me/events') || u.includes('/me/events?')) return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } };
    if (u.endsWith('/v1/chat/completions')) {
      const body = JSON.parse(init.body); const status = chatStatus(chats.length, body);
      if (status !== 200) { chats.push({ body, status }); return json(status, { error: {} }, { 'Retry-After': '1' }); }
      const reply = openReply(); chats.push({ body, status, reply });
      if (init.signal) init.signal.addEventListener('abort', () => reply.fail(new Error('aborted')));
      return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reply.reader } };
    }
    if (u.includes('/me/feed?')) return json(200, { items: feedItems, cursor: null, unread: feedItems.length });
    if (u.endsWith('/me/files')) { const names = init.body.getAll('files'); uploads.push(names); return json(200, { files: names.map((n) => ({ fileName: n, publicUrl: 'https://files.example/' + n })) }); }
    if (u.includes('/me/approvals/')) return json(200, { status: 'granted', session_id: 'sess-B' });
    if (u.endsWith('/me/browser-sign-in') && method === 'POST') { signIn.opened.push(JSON.parse(init.body)); return signIn.refuse ? json(signIn.refuse, { detail: {} }) : json(201, { id: 'v-1', view_url: 'https://8765-sbx.e2b.app/#t=secret-token', site: 'shop.example.com', expires_at: '2026-11-22T00:05:00Z' }); }
    if (u.endsWith('/me/browser-sign-in') && method === 'GET') { signIn.polls += 1; return json(200, { active: signIn.polls < signIn.activeFor }); }
    if (/\/rooms\/[^/]+\/messages$/.test(u) && method === 'POST') { rooms.posts.push({ path: u.replace(/^.*\/api\/external/, ''), body: JSON.parse(init.body) }); return rooms.refuse ? json(rooms.refuse, { detail: {} }) : json(202, { message: {}, reply: 'pending' }); }
    if (u.endsWith('/me/connections')) return json(200, connections);
    if (u.endsWith('/me/connect-sessions')) return connections.items.length ? json(200, { url: 'https://junis.ai/connect/abc' }) : json(400, { detail: {} });
    if (u.endsWith('/me/schedules')) return json(200, { schedules: [] });
    if (u.endsWith('/me') && method === 'GET') return json(200, { name: 'Sam', settings: { timezone: 'Asia/Seoul' } });
    return json(200, {});
  };
  const context = vm.createContext({
    document, fetch, console, TextDecoder, TextEncoder, FormData, Date, Promise, JSON, Number, String, Math, Array, Object, Error, Intl, encodeURIComponent, URL,
    crypto: { randomUUID: () => 'route-1' }, location: { origin: 'https://app.example', pathname: '/', assign(u) { opened.push(u); } },
    window: { open: (url, target) => { const tab = { url, target, location: url, opener: {}, closed: false, close() { this.closed = true; } }; tabs.push(tab); return tab; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; }, AbortController,
  });
  vm.runInContext(SCRIPT, context);
  const tick = async (n = 12) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
  const type = async (text) => { els.text.value = text; for (const fn of els.chat.listeners.submit) fn({ preventDefault() {} }); await tick(); };
  return { els, chats, timers, tick, type, requests, opened, uploads, signIn, tabs, rooms };
}

const sent = (app) => app.chats.map((c) => c.body.messages[0].content);

describe('the personal assistant example behaves like a chat app (run, not read)', () => {
  test('a message typed while a reply is streaming goes out by itself when that reply ends', async () => {
    const app = boot(); await app.tick();
    await app.type('one');
    assert.deepEqual(sent(app), ['one']);
    await app.type('two');
    assert.deepEqual(sent(app), ['one'], 'one request per conversation at a time');
    assert.match(app.els.state.textContent, /Queued/);
    app.chats[0].reply.say({ session_id: 'sess-1', choices: [{ delta: { content: 'Hi' } }] }); app.chats[0].reply.end(); await app.tick();
    assert.deepEqual(sent(app), ['one', 'two'], 'the queued message is sent without the person typing again');
    assert.equal(app.chats[1].body.session_id, 'sess-1', 'and it continues the same conversation');
    assert.equal(app.els.state.textContent, '', 'the "queued" note is gone once it is sent');
  });

  test('queued messages keep the order they were typed in', async () => {
    const app = boot(); await app.tick();
    await app.type('one'); await app.type('two'); await app.type('three');
    app.chats[0].reply.end(); await app.tick();
    assert.deepEqual(sent(app), ['one', 'two']);
    await app.type('four');
    app.chats[1].reply.end(); await app.tick();
    app.chats[2].reply.end(); await app.tick();
    assert.deepEqual(sent(app), ['one', 'two', 'three', 'four']);
  });

  test('an approval given while another reply is streaming still carries the decision', async () => {
    const app = boot(); await app.tick();
    await app.type('send the mail');
    app.chats[0].reply.say({ session_id: 'sess-1', event: 'tool_confirmation_required', confirmations: [{ confirmation_id: 'c-1', tool_name: 'send_mail' }] });
    app.chats[0].reply.end(); await app.tick();
    const allow = app.els.cards.find((n) => n.tag === 'button' && n.textContent === 'Allow');
    assert.ok(allow, 'the approval card is shown');
    await app.type('and tell me when it is done');                       // a second reply is now streaming
    allow.onclick(); await app.tick();
    assert.equal(app.chats.length, 2, 'the decision waits for the open reply');
    app.chats[1].reply.end(); await app.tick();
    assert.equal(app.chats.length, 3);
    assert.deepEqual(app.chats[2].body.tool_confirmations, [{ confirmation_id: 'c-1', approved: true }], 'the queued call still answers the card');
  });

  test('a busy conversation (409) is retried with the same decision, not as a plain message', async () => {
    const app = boot({ chatStatus: (n) => (n === 1 ? 409 : 200) }); await app.tick();
    await app.type('send the mail');
    app.chats[0].reply.say({ session_id: 'sess-1', event: 'tool_confirmation_required', confirmations: [{ confirmation_id: 'c-1', tool_name: 'send_mail' }] });
    app.chats[0].reply.end(); await app.tick();
    app.els.cards.find((n) => n.tag === 'button' && n.textContent === 'Allow').onclick(); await app.tick();
    assert.equal(app.chats[1].status, 409);
    const retry = app.timers.find((t) => t.ms === 1000);
    assert.ok(retry, 'it waits for Retry-After');
    retry.fn(); await app.tick();
    assert.equal(app.chats.length, 3);
    assert.deepEqual(app.chats[2].body.tool_confirmations, [{ confirmation_id: 'c-1', approved: true }]);
    assert.equal(app.els.log.children.filter((n) => n.className === 'msg user').length, 1, 'the retry does not draw the message a second time');
  });

  test('a failed request does not strand the messages typed after it', async () => {
    const app = boot({ chatStatus: (n) => (n === 0 ? 500 : 200) }); await app.tick();
    app.els.text.value = 'one'; for (const fn of app.els.chat.listeners.submit) fn({ preventDefault() {} });
    app.els.text.value = 'two'; for (const fn of app.els.chat.listeners.submit) fn({ preventDefault() {} });
    await app.tick();
    assert.deepEqual(sent(app), ['one', 'two'], 'the second message is sent after the first one fails');
  });

  test('Connect: a squad that needs nothing from the user says so instead of failing', async () => {
    const app = boot({ connections: { all_connected: false, items: [] } }); await app.tick();
    await app.els.connect.onclick(); await app.tick();
    assert.ok(!app.requests.includes('POST /me/connect-sessions'), 'no link is asked for: the server answers 400 when there is nothing to connect');
    assert.match(app.els.settingsNote.textContent, /nothing to connect/i);
    assert.deepEqual(app.opened, []);
  });

  test('Connect: something missing opens the link; everything connected says so', async () => {
    const missing = boot({ connections: { all_connected: false, items: [{ name: 'Gmail', connected: false }] } }); await missing.tick();
    await missing.els.connect.onclick(); await missing.tick();
    assert.deepEqual(missing.opened, ['https://junis.ai/connect/abc']);
    const done = boot({ connections: { all_connected: true, items: [{ name: 'Gmail', connected: true }] } }); await done.tick();
    await done.els.connect.onclick(); await done.tick();
    assert.deepEqual(done.opened, []);
    assert.match(done.els.settingsNote.textContent, /connected/i);
  });

  test('approving from the inbox does not move messages already typed to the other conversation', async () => {
    const app = boot({ feedItems: [{ id: 'f1', kind: 'approval', title: 'Send the report?', data: { confirmation_id: 'c-9' }, session_id: 'sess-B', created_at: '2026-11-21T10:00:00Z' }] });
    await app.tick();
    await app.type('one'); await app.type('two');                         // "two" waits; the conversation has no id yet
    app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Approve').onclick(); await app.tick();
    app.chats[0].reply.say({ session_id: 'sess-A', choices: [{ delta: { content: 'Hi' } }] }); app.chats[0].reply.end(); await app.tick();
    assert.equal(app.chats[1].body.messages[0].content, 'two');
    assert.equal(app.chats[1].body.session_id, 'sess-A', '"two" was typed in the first conversation and stays there');
    app.chats[1].reply.end(); await app.tick();
    assert.match(app.chats[2].body.messages[0].content, /approved/);
    assert.equal(app.chats[2].body.session_id, 'sess-B', 'the go-ahead goes to the conversation that asked');
    app.chats[2].reply.end(); await app.tick();
    await app.type('three');
    assert.equal(app.chats[3].body.session_id, 'sess-B', 'the page now continues in that conversation');
  });

  test('a queued message keeps the files picked with it, and a retry does not lose or re-upload them', async () => {
    const app = boot({ chatStatus: (n) => (n === 1 ? 409 : 200) }); await app.tick();
    await app.type('one');
    app.els.file.files = ['P.png']; await app.type('two');                // queued with P
    app.els.file.files = ['Q.png'];                                       // picked for the next message, before "one" ends
    app.chats[0].reply.end(); await app.tick();
    assert.deepEqual(app.uploads, [['P.png']], '"two" uploads what was picked with it');
    assert.equal(app.chats[1].status, 409);
    assert.deepEqual(app.chats[1].body.files, ['https://files.example/P.png']);
    app.timers.find((t) => t.ms === 1000).fn(); await app.tick();
    assert.deepEqual(app.chats[2].body.files, ['https://files.example/P.png'], 'the retry carries the same addresses');
    assert.deepEqual(app.uploads, [['P.png']], 'and does not upload again');
    assert.deepEqual(app.els.file.files, ['Q.png'], 'the next pick is untouched');
    app.chats[2].reply.end(); await app.tick();
    await app.type('three');
    assert.deepEqual(app.uploads, [['P.png'], ['Q.png']]);
    assert.deepEqual(app.chats[3].body.files, ['https://files.example/Q.png']);
  });

  test('an answer to a card that fails to send brings the card back', async () => {
    const app = boot({ chatStatus: (n) => (n === 1 ? 500 : 200) }); await app.tick();
    await app.type('send the mail');
    app.chats[0].reply.say({ session_id: 'sess-1', event: 'tool_confirmation_required', confirmations: [{ confirmation_id: 'c-1', tool_name: 'send_mail' }] });
    app.chats[0].reply.end(); await app.tick();
    const allow = () => app.els.cards.find((n) => n.tag === 'button' && n.textContent === 'Allow');
    allow().onclick(); await app.tick();
    assert.equal(app.chats[1].status, 500);
    assert.ok(allow(), 'the request is still open on the server, so the card is shown again');
    allow().onclick(); await app.tick();
    assert.deepEqual(app.chats[2].body.tool_confirmations, [{ confirmation_id: 'c-1', approved: true }]);
  });

  test('an answer to a card goes before messages that were waiting', async () => {
    const app = boot(); await app.tick();
    await app.type('send the mail');
    app.chats[0].reply.say({ session_id: 'sess-1', event: 'tool_confirmation_required', confirmations: [{ confirmation_id: 'c-1', tool_name: 'send_mail' }] });
    app.chats[0].reply.end(); await app.tick();
    await app.type('x'); await app.type('y');                             // "x" is streaming, "y" waits
    app.els.cards.find((n) => n.tag === 'button' && n.textContent === 'Allow').onclick(); await app.tick();
    app.chats[1].reply.end(); await app.tick();
    assert.ok(app.chats[2].body.tool_confirmations, 'the conversation is waiting for this answer');
    app.chats[2].reply.end(); await app.tick();
    assert.equal(app.chats[3].body.messages[0].content, 'y');
  });

  test('a message typed while a 409 retry is waiting goes after the retried one', async () => {
    const app = boot({ chatStatus: (n) => (n === 0 ? 409 : 200) }); await app.tick();
    await app.type('one'); await app.type('two');
    assert.equal(app.chats.length, 1, 'nothing overtakes the message that is waiting to be retried');
    app.timers.find((t) => t.ms === 1000).fn(); await app.tick();
    app.chats[1].reply.end(); await app.tick();
    assert.deepEqual(sent(app), ['one', 'one', 'two']);
  });

  test('a reply cut off part-way keeps what was already shown', async () => {
    const app = boot(); await app.tick();
    await app.type('one'); await app.type('two');
    app.chats[0].reply.say({ session_id: 'sess-1', choices: [{ delta: { content: 'The meeting is' } }] }); await app.tick();
    app.chats[0].reply.fail(); await app.tick();
    assert.ok(app.els.log.children.some((n) => n.className === 'msg bot' && n.textContent === 'The meeting is'), 'the partial reply stays');
    assert.deepEqual(sent(app), ['one', 'two'], 'and the next message still goes out');
  });

  test('a reply that stops sending anything is given up on, so the chat is not stuck', async () => {
    const app = boot(); await app.tick();
    await app.type('one'); await app.type('two');
    const watchdog = app.timers.filter((t) => t.ms >= 60000 && !t.cancelled).at(-1);
    assert.ok(watchdog, 'a stalled stream has a deadline');
    watchdog.fn(); await app.tick();
    assert.deepEqual(sent(app), ['one', 'two'], 'the waiting message goes out after the stalled reply is dropped');
  });

  test('a sign-in request from the assistant opens the view in a new tab and tells the assistant when it is done', async () => {
    const item = { id: 'f-9', kind: 'connection', title: 'Sign in to shop.example.com', body: 'To check your orders.', session_id: 'sess-S',
      data: { type: 'browser_sign_in', url: 'https://shop.example.com/login' }, created_at: '2026-11-22T00:00:00Z' };
    const app = boot({ feedItems: [item] }); await app.tick();
    const button = app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Sign in');
    assert.ok(button, 'the request shows a Sign in button');
    assert.ok(app.els.feed.find((n) => n.tag === 'strong' && n.textContent === 'shop.example.com'), 'the site is shown next to the button, taken from the address');
    button.onclick(); await app.tick();
    assert.deepEqual(app.signIn.opened, [{ url: 'https://shop.example.com/login' }], 'the app asks for a view of the page the assistant named');
    assert.equal(app.tabs.length, 1);
    assert.equal(app.tabs[0].target, '_blank');
    assert.equal(app.tabs[0].location, 'https://8765-sbx.e2b.app/#t=secret-token', 'the view opens in the new tab');
    assert.equal(app.tabs[0].opener, null, 'the view cannot reach back into the app page');
    assert.ok(!app.els.feed.textContent.includes('secret-token') && !app.els.state.textContent.includes('secret-token'), 'the address is never shown');
    assert.equal(app.chats.length, 0, 'nothing is said to the assistant while the person is still signing in');
    // the app asks every few seconds whether the view is still open; the second answer says it ended (the person pressed Done)
    for (let i = 0; i < 3 && app.chats.length === 0; i += 1) { const wait = app.timers.filter((t) => t.ms === 4000 && !t.fired).at(-1); if (!wait) break; wait.fired = true; wait.fn(); await app.tick(); }
    assert.equal(app.signIn.polls, 2);
    assert.ok(app.requests.includes('POST /me/feed/read'), 'the request is marked as handled');
    assert.equal(app.chats.length, 1);
    assert.match(app.chats[0].body.messages[0].content, /signed in/i);
    assert.equal(app.chats[0].body.session_id, 'sess-S', 'the assistant is told in the conversation that asked');
  });

  test('a sign-in view that cannot open says so and can be tried again', async () => {
    const item = { id: 'f-9', kind: 'connection', title: 'Sign in', data: { type: 'browser_sign_in', url: 'https://shop.example.com/login' }, created_at: '2026-11-22T00:00:00Z' };
    const app = boot({ feedItems: [item] }); await app.tick();
    app.signIn.refuse = 409;
    const button = app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Sign in');
    button.onclick(); await app.tick();
    assert.ok(app.tabs[0].closed, 'the empty tab is closed again');
    assert.equal(button.disabled, false);
    assert.match(app.els.feed.textContent, /409/);
    assert.equal(app.chats.length, 0);
  });

  test('other connection items and items already read get no Sign in button', async () => {
    const items = [{ id: 'a', kind: 'connection', title: 'Connect Gmail', data: { type: 'something_else' }, created_at: '2026-11-22T00:00:00Z' },
      { id: 'b', kind: 'connection', title: 'Sign in', read_at: '2026-11-22T00:01:00Z', data: { type: 'browser_sign_in', url: 'https://x.example/' }, created_at: '2026-11-22T00:00:00Z' },
      { id: 'c', kind: 'connection', title: 'Sign in', data: { type: 'browser_sign_in', url: 'javascript:alert(1)' }, created_at: '2026-11-22T00:00:00Z' }];
    const app = boot({ feedItems: items }); await app.tick();
    assert.equal(app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Sign in'), null);
  });

  test('saying "I signed in" in the app closes the view instead of waiting for it', async () => {
    const item = { id: 'f-9', kind: 'connection', title: 'Sign in', session_id: 'sess-S', data: { type: 'browser_sign_in', url: 'https://shop.example.com/login' }, created_at: '2026-11-22T00:00:00Z' };
    const app = boot({ feedItems: [item] }); await app.tick();
    app.signIn.activeFor = 99;                                             // the person never presses Done on the view
    app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Sign in').onclick(); await app.tick();
    const here = app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'I signed in');
    assert.ok(here, 'the row offers a way to say so here');
    here.onclick();
    const wait = app.timers.filter((t) => t.ms === 4000 && !t.fired).at(-1); wait.fired = true; wait.fn(); await app.tick();
    assert.ok(app.requests.includes('DELETE /me/browser-sign-in'), 'the view is closed (the assistant can use the workspace again, billing stops)');
    assert.equal(app.chats.length, 1);
    assert.match(app.chats[0].body.messages[0].content, /signed in/i);
  });

  // The assistant prepared a message for one of the person's rooms (tool suggest_room_message). It posts nothing itself.
  const draft = () => ({ id: 'f-room', kind: 'room', title: 'Send to Trip', body: 'I am free Sat 10-14 and Sun after 16.', session_id: 'sess-A',
    data: { type: 'room_draft', room_id: 'room 1/x', room_name: 'Trip', addressed: true, member_count: 4, others: ['Lee', 'Kim', 'Pat'] }, created_at: '2026-11-23T00:00:00Z' });

  test('a message prepared for a room goes to the room only when the person presses Send, once, as shown', async () => {
    const app = boot({ feedItems: [draft()] }); await app.tick();
    assert.deepEqual(app.rooms.posts, [], 'showing the card sends nothing');
    const button = app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Send to Trip');
    assert.ok(button, 'the card names the room');
    assert.ok(app.els.feed.find((n) => n.textContent === 'To Lee, Kim, Pat'), 'and who is in it: a room is named by whoever made it');
    button.onclick(); button.onclick(); await app.tick();                 // a double press
    assert.deepEqual(app.rooms.posts, [{ path: '/rooms/room%201%2Fx/messages', body: { text: 'I am free Sat 10-14 and Sun after 16.', addressed: true } }],
      'exactly the text the person saw, to that room, once');
    assert.ok(app.requests.includes('POST /me/feed/read'), 'the card is marked as handled');
    assert.ok(app.els.feed.find((n) => n.textContent === 'Sent.'));
    assert.equal(app.chats.length, 0, 'no message is sent to the assistant on its behalf');
  });

  test('a prepared room message can be discarded, and a refused send can be tried again', async () => {
    const app = boot({ feedItems: [draft()] }); await app.tick();
    app.rooms.refuse = 404;                                                // the person left the room in the meantime
    const button = app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Send to Trip');
    button.onclick(); await app.tick();
    assert.equal(app.rooms.posts.length, 1);
    assert.equal(button.disabled, false, 'the person can try again');
    assert.ok(!app.requests.includes('POST /me/feed/read'), 'a send that failed is not marked as handled');
    app.els.feed.find((n) => n.tag === 'button' && n.textContent === 'Discard').onclick(); await app.tick();
    assert.ok(app.requests.includes('POST /me/feed/read'));
    assert.ok(app.els.feed.find((n) => n.textContent === 'Not sent.'));
    assert.equal(app.rooms.posts.length, 1, 'discarding sends nothing');
  });

  test('a room notice that is not a prepared message, or one already handled, has no Send button', async () => {
    const notice = { id: 'f-n', kind: 'room', title: 'Trip', body: 'Lee: hello', data: { room_id: 'room-1', seq: 4, role: 'user' }, created_at: '2026-11-23T00:00:00Z' };
    const handled = { ...draft(), id: 'f-h', read_at: '2026-11-23T01:00:00Z' };
    const app = boot({ feedItems: [notice, handled] }); await app.tick();
    assert.ok(!app.els.feed.find((n) => n.tag === 'button' && /^Send to/.test(n.textContent || '')));
  });
});
