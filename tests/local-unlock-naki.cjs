// 以 Naki 實際的 JS runtime 跑本插件。Run: NAKI_ROOT=<Naki repo> node --test tests/local-unlock-naki.cjs（未設 NAKI_ROOT 則略過）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.NAKI_ROOT;
const skip = root ? false : 'NAKI_ROOT 未設定';
const dir = path.join(__dirname, '../plugins/naki-plugin-ex-local-unlock');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
const pluginSource = () => fs.readFileSync(process.env.UNLOCK_PLUGIN_JS || path.join(dir, 'plugin.js'), 'utf8');

const vi = n => { const o = []; for (; n > 127; n = Math.floor(n / 128)) o.push((n % 128) | 128); o.push(n); return o; };
const uv = (f, n) => [...vi(f * 8), ...vi(n)];
const ld = (f, bytes) => [...vi(f * 8 + 2), ...vi(bytes.length), ...bytes];
const request = (msgId, method, payload = []) => Uint8Array.from([2, msgId & 255, msgId >> 8, ...ld(1, [...Buffer.from(method)]), ...ld(2, payload)]);
const response = (msgId, payload) => Uint8Array.from([3, msgId & 255, msgId >> 8, 10, 0, ...ld(2, payload)]);
const ME = 111, CHAR = 200005, SKIN_ID = 400501;
const CHARS = '.lq.Lobby.fetchCharacterInfo', ACCOUNT = '.lq.Lobby.fetchAccountInfo', SKIN = '.lq.Lobby.changeCharacterSkin';
const AUTH = '.lq.FastTest.authGame';
const SETTINGS = { enabled: true, testAccountAck: true, titleId: 600002, views: '', characterId: CHAR, skinId: SKIN_ID };
const charInfo = [...ld(2, [...uv(1, 200001), ...uv(5, 400101)]), ...ld(3, vi(400101)), ...uv(4, 200001)];
const authPayload = [...ld(2, [...uv(1, ME), ...uv(3, 600001)]), ...ld(2, [...uv(1, 222), ...uv(3, 600001)])];
const authRewritten = [...ld(2, [...uv(1, ME), ...uv(3, 600002)]), ...ld(2, [...uv(1, 222), ...uv(3, 600001)])];
const plain = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setTimeout(r, 0));

function page({ grant = {}, settings = SETTINGS } = {}) {
  const source = name => fs.readFileSync(path.join(root, 'command/Resources/JavaScript', name), 'utf8');
  const errorListeners = [];
  // 依 Naki P4 回歸的 capture 模型：target 上 capture listener 先跑，stopImmediatePropagation 有效（WebKit 實測）；
  // listener 拋錯不傳回 dispatchEvent，改送 window 的 error 事件。
  class MessageEvent {
    constructor(type, init = {}) { Object.assign(this, { type, data: init.data, origin: '', lastEventId: '', stopped: false }); }
    stopImmediatePropagation() { this.stopped = true; }
  }
  class Socket {
    constructor(url) { this.url = url; this.readyState = 1; this.binaryType = 'arraybuffer'; this.listeners = []; this.sent = []; }
    addEventListener(k, f, capture) { if (k === 'message') this.listeners.push({ fn: f, capture: !!capture }); }
    set onmessage(f) { this.listeners.push({ fn: f, capture: false }); }
    send(d) { this.sent.push(d); }
    dispatchEvent(ev) {
      for (const l of this.listeners.filter(l => l.capture).concat(this.listeners.filter(l => !l.capture))) {
        if (ev.stopped) break;
        try { l.fn.call(this, ev); } catch (e) { errorListeners.forEach(f => f({ error: e })); }
      }
      return true;
    }
    receive(u8) { this.dispatchEvent(new MessageEvent('message', { data: u8.buffer.slice(0) })); }
  }
  Socket.OPEN = 1; Socket.CLOSED = 3;
  const logs = [];
  const c = { console: { log() {}, error() {} }, Uint8Array, ArrayBuffer, DataView, Blob, MessageEvent, setTimeout,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    document: { getElementById: () => null }, __nakiPluginGrants: {},
    addEventListener: (k, f) => { if (k === 'error') errorListeners.push(f); } };
  c.window = c; c.WebSocket = Socket; vm.createContext(c);
  vm.runInContext(source('naki-core.js'), c);
  c.__nakiCore.sendToSwift = (type, data) => { if (type === 'plugin_log' || type === 'plugin_event') logs.push(plain(data)); };
  vm.runInContext(source('naki-websocket.js'), c);
  vm.runInContext(source('naki-plugins.js'), c);
  const enable = () => {
    c.__nakiPlugins.setGrant(manifest.id, { capabilities: manifest.capabilities, methods: manifest.methods,
      sendGuard: manifest.sendGuard, settings, ...grant });
    vm.runInContext(pluginSource(), c);
  };
  enable();
  const socket = url => {
    const ws = new c.WebSocket(url), got = [];
    ws.onmessage = ev => { if (ws.fail) { ws.fail = false; throw new Error('game decode failed'); } got.push(Array.from(new Uint8Array(ev.data))); };
    return { ws, got };
  };
  const lobby = socket('wss://route-4.maj-soul.com/gateway');
  lobby.ws.send(request(1, '.lq.Lobby.oauth2Login', uv(1, 1)));
  lobby.ws.receive(response(1, uv(2, ME)));
  const t = { c, lobby, logs, enable, socket,
    guardLog: () => plain(c.__nakiPlugins.guardState()).log,
    async fetch(msgId, method, payload) { lobby.ws.send(request(msgId, method)); lobby.ws.receive(response(msgId, payload)); await tick(); return lobby.got.at(-1); },
    async skin(msgId) { lobby.ws.send(request(msgId, SKIN, uv(1, SKIN_ID))); await tick(); return lobby.ws.sent.length; },
  };
  return t;
}
// 對局連線：第一個 FastTest 請求鎖定角色為 game
function game(t) {
  const g = t.socket('wss://route-4.maj-soul.com/game-gateway');
  return {
    ...g,
    async auth(msgId, id = ME, payload = authPayload) {
      g.ws.send(request(msgId, AUTH, uv(1, id)));
      return payload;
    },
    async answer(msgId, payload = authPayload) { g.ws.receive(response(msgId, payload)); await tick(); return g.got.at(-1); },
  };
}

test('Naki forbids neither lobby method for variable-length replace, and accepts the manifest guard list', { skip }, () => {
  const t = page();
  assert.equal(t.c.__nakiPlugins.isReshapeForbidden(CHARS), false);
  assert.equal(t.c.__nakiPlugins.isReshapeForbidden(ACCOUNT), false);
  assert.equal(t.c.__nakiPlugins.isReshapeForbidden(AUTH), true);
  assert.ok(t.c.__nakiPlugins.list().some(p => p.id === manifest.id));
});

test('the game receives the reshaped fetchCharacterInfo, then a skin change never leaves and gets a local error', { skip }, async () => {
  const t = page();
  assert.equal(await t.skin(2), 2, 'an owned skin change before any rewrite still goes out');
  const got = await t.fetch(3, CHARS, charInfo);
  assert.deepEqual(got, Array.from(response(3, [...ld(2, [...uv(1, 200001), ...uv(5, 400101)]), ...ld(3, vi(400101)),
    ...ld(2, [...uv(1, CHAR), ...uv(5, SKIN_ID)]), ...uv(3, SKIN_ID), ...uv(4, CHAR)])));
  assert.deepEqual(plain(t.c.__nakiWebSocket.diagnostics().reshape), { attempted: 1, delivered: 1, dropped: 0, fallback: 0, faults: 0 });
  assert.equal(await t.skin(4), 3, 'the guarded request is not sent');
  assert.deepEqual(t.lobby.got.at(-1), [3, 4, 0, 10, 0, 18, 4, 10, 2, 8, 6]);
  assert.ok(t.logs.some(l => l.kind === 'tainted'));
});

test('with L3 on, the plugin still refuses guarded requests after a rewrite', { skip }, async () => {
  const t = page();
  t.c.__nakiPluginsMayModifyOutbound = true;
  await t.fetch(2, CHARS, charInfo);
  assert.equal(await t.skin(3), 2);
  assert.equal(t.guardLog().at(-1).reason, 'hook_threw');
});

test('a grant without sendGuard (older Naki shape): the game gets the original bytes', { skip }, async () => {
  const t = page({ grant: { sendGuard: undefined } });
  assert.deepEqual(await t.fetch(2, CHARS, charInfo), Array.from(response(2, charInfo)));
  assert.ok(t.logs.some(l => /2\.20\.0/.test(l.msg || '')));
});

test('auth-only: without a lobby rewrite authGame is left alone, so disabling leaves nothing to guard', { skip }, async () => {
  const t = page({ settings: { ...SETTINGS, characterId: 0, skinId: 0 } });
  const g = game(t);
  await g.auth(10);
  assert.deepEqual(await g.answer(10), Array.from(response(10, authPayload)));
  assert.ok(t.logs.some(l => /對局內不改寫/.test(l.msg || '')));
  t.c.__nakiPlugins.disable(manifest.id);
  assert.equal(await t.skin(11), 2, 'nothing was rewritten, so a real skin change goes out');
});

test('after a lobby rewrite, authGame is rewritten; hot-disable and L3 on still never send a guarded request', { skip }, async () => {
  const t = page();
  await t.fetch(2, CHARS, charInfo);
  const g = game(t);
  await g.auth(10);
  assert.deepEqual(await g.answer(10), Array.from(response(10, authRewritten)));
  t.c.__nakiPlugins.disable(manifest.id);
  assert.ok(!t.c.__nakiPlugins.list().some(p => p.id === manifest.id));
  t.c.__nakiPluginsMayModifyOutbound = true;
  assert.equal(await t.skin(11), 2);
  assert.equal(t.guardLog().at(-1).reason, 'not_on_chain');
  t.enable();
  assert.equal(await t.skin(12), 2, 're-enabled in the same page: the window flag still refuses');
  assert.equal(t.guardLog().at(-1).reason, 'hook_threw');
});

test('auto-removal after ten refusals: the host taint keeps blocking guarded requests', { skip }, async () => {
  const t = page();
  await t.fetch(2, CHARS, charInfo);
  for (let i = 0; i < 10; i++) await t.skin(20 + i);
  assert.ok(!t.c.__nakiPlugins.list().some(p => p.id === manifest.id), 'the plugin was auto-removed');
  assert.equal(await t.skin(40), 2);
  assert.equal(t.guardLog().at(-1).reason, 'not_on_chain');
});

test('authGame responses pair with their own request: out of order, the foreign one is not rewritten', { skip }, async () => {
  const t = page();
  await t.fetch(2, CHARS, charInfo);
  const g = game(t);
  await g.auth(10, 222);
  await g.auth(11, ME);
  assert.deepEqual(await g.answer(10), Array.from(response(10, authPayload)));
  assert.deepEqual(await g.answer(11), Array.from(response(11, authRewritten)));
});

test('D10 delivery fault: replace returned true but the host locks; later lobby rewrites stop and the guard holds', { skip }, async () => {
  const t = page();
  t.lobby.ws.fail = true;
  t.lobby.ws.send(request(2, CHARS));
  t.lobby.ws.receive(response(2, charInfo));
  await tick();
  const d = plain(t.c.__nakiWebSocket.diagnostics());
  assert.equal(d.reshapeLocked, true);
  assert.equal(d.reshape.faults, 1);
  assert.deepEqual(plain(t.c.__nakiPlugins.guardState()).tainted[manifest.id].length, manifest.sendGuard.length);
  assert.deepEqual(await t.fetch(3, ACCOUNT, ld(2, [...uv(1, ME), ...uv(7, 0)])), Array.from(response(3, ld(2, [...uv(1, ME), ...uv(7, 0)]))));
  assert.ok(t.logs.some(l => /不再改大廳/.test(l.msg || '')));
  assert.equal(t.c.__nakiLocalUnlock.lobbyLocked, true);
  assert.equal(await t.skin(4), 3, 'login, two fetches, and no skin change');
  assert.equal(t.guardLog().at(-1).outcome, 'local_error');
});
