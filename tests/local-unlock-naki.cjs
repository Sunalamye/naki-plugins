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

const vi = n => { const o = []; for (; n > 127; n = Math.floor(n / 128)) o.push((n % 128) | 128); o.push(n); return o; };
const uv = (f, n) => [...vi(f * 8), ...vi(n)];
const ld = (f, bytes) => [...vi(f * 8 + 2), ...vi(bytes.length), ...bytes];
const request = (msgId, method, payload = []) => Uint8Array.from([2, msgId & 255, msgId >> 8, ...ld(1, [...Buffer.from(method)]), ...ld(2, payload)]);
const response = (msgId, payload) => Uint8Array.from([3, msgId & 255, msgId >> 8, 10, 0, ...ld(2, payload)]);
const ME = 111, CHAR = 200005, SKIN_ID = 400501;
const CHARS = '.lq.Lobby.fetchCharacterInfo', SKIN = '.lq.Lobby.changeCharacterSkin';
const SETTINGS = { enabled: true, testAccountAck: true, titleId: 0, views: '', characterId: CHAR, skinId: SKIN_ID };
const charInfo = [...ld(2, [...uv(1, 200001), ...uv(5, 400101)]), ...ld(3, vi(400101)), ...uv(4, 200001)];
const plain = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setTimeout(r, 0));

function page(grant) {
  const source = name => fs.readFileSync(path.join(root, 'command/Resources/JavaScript', name), 'utf8');
  // 依 Naki P4 回歸的 capture 模型：target 上 capture listener 先跑，stopImmediatePropagation 有效（WebKit 實測）
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
        l.fn.call(this, ev);
      }
      return true;
    }
    receive(u8) { this.dispatchEvent(new MessageEvent('message', { data: u8.buffer.slice(0) })); }
  }
  Socket.OPEN = 1; Socket.CLOSED = 3;
  const logs = [];
  const c = { console: { log() {}, error() {} }, Uint8Array, ArrayBuffer, DataView, Blob, MessageEvent, setTimeout,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    document: { getElementById: () => null }, __nakiPluginGrants: {}, addEventListener() {} };
  c.window = c; c.WebSocket = Socket; vm.createContext(c);
  vm.runInContext(source('naki-core.js'), c);
  c.__nakiCore.sendToSwift = (type, data) => { if (type === 'plugin_log' || type === 'plugin_event') logs.push(plain(data)); };
  vm.runInContext(source('naki-websocket.js'), c);
  vm.runInContext(source('naki-plugins.js'), c);
  c.__nakiPlugins.setGrant(manifest.id, { capabilities: manifest.capabilities, methods: manifest.methods,
    sendGuard: manifest.sendGuard, settings: SETTINGS, ...grant });
  vm.runInContext(fs.readFileSync(process.env.UNLOCK_PLUGIN_JS || path.join(dir, 'plugin.js'), 'utf8'), c);
  const lobby = new c.WebSocket('wss://route-4.maj-soul.com/gateway');
  const game = [];
  lobby.onmessage = ev => game.push(Array.from(new Uint8Array(ev.data)));
  lobby.send(request(1, '.lq.Lobby.oauth2Login', uv(1, 1)));
  lobby.receive(response(1, uv(2, ME)));
  return { c, lobby, game, logs };
}

test('Naki forbids neither lobby method for variable-length replace, and accepts the manifest guard list', { skip }, () => {
  const t = page();
  assert.equal(t.c.__nakiPlugins.isReshapeForbidden(CHARS), false);
  assert.equal(t.c.__nakiPlugins.isReshapeForbidden('.lq.Lobby.fetchAccountInfo'), false);
  assert.equal(t.c.__nakiPlugins.isReshapeForbidden('.lq.FastTest.authGame'), true);
  assert.ok(t.c.__nakiPlugins.list().some(p => p.id === manifest.id));
});

test('the game receives the reshaped fetchCharacterInfo, then a skin change never leaves and gets a local error', { skip }, async () => {
  const t = page();
  t.lobby.send(request(2, SKIN, uv(1, 400101)));
  assert.equal(t.lobby.sent.length, 2, 'an owned skin change before any rewrite still goes out');
  t.lobby.send(request(3, CHARS));
  t.lobby.receive(response(3, charInfo));
  await tick();
  const want = Array.from(response(3, [...ld(2, [...uv(1, 200001), ...uv(5, 400101)]), ...ld(3, vi(400101)),
    ...ld(2, [...uv(1, CHAR), ...uv(5, SKIN_ID)]), ...uv(3, SKIN_ID), ...uv(4, CHAR)]));
  assert.deepEqual(t.game.at(-1), want);
  assert.deepEqual(plain(t.c.__nakiWebSocket.diagnostics().reshape), { attempted: 1, delivered: 1, dropped: 0, fallback: 0, faults: 0 });
  t.lobby.send(request(4, SKIN, uv(1, SKIN_ID)));
  await tick();
  assert.equal(t.lobby.sent.length, 3, 'the guarded request is not sent');
  assert.deepEqual(t.game.at(-1), [3, 4, 0, 10, 0, 18, 4, 10, 2, 8, 6]);
  assert.ok(t.logs.some(l => l.kind === 'tainted'));
});

test('with L3 on, the plugin still refuses guarded requests after a rewrite', { skip }, async () => {
  const t = page();
  t.c.__nakiPluginsMayModifyOutbound = true;
  t.lobby.send(request(2, CHARS));
  t.lobby.receive(response(2, charInfo));
  await tick();
  t.lobby.send(request(3, SKIN, uv(1, SKIN_ID)));
  await tick();
  assert.equal(t.lobby.sent.length, 2);
  assert.equal(t.c.__nakiPlugins.guardState().log.at(-1).reason, 'hook_threw');
});

test('a grant without sendGuard (older Naki shape): the game gets the original bytes', { skip }, async () => {
  const t = page({ sendGuard: undefined });
  t.lobby.send(request(2, CHARS));
  t.lobby.receive(response(2, charInfo));
  await tick();
  assert.deepEqual(t.game.at(-1), Array.from(response(2, charInfo)));
  assert.ok(t.logs.some(l => /2\.20\.0/.test(l.msg || '')));
});
