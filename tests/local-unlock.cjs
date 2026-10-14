const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../plugins/naki-plugin-ex-local-unlock');
const source = fs.readFileSync(process.env.UNLOCK_PLUGIN_JS || path.join(dir, 'plugin.js'), 'utf8');

// 最小 protobuf 編碼器：fixture 在測試時組出，不提交真實封包。
const vi = n => { const o = []; for (; n > 127; n = Math.floor(n / 128)) o.push((n % 128) | 128); o.push(n); return o; };
const uv = (f, n) => [...vi(f * 8), ...vi(n)];
const ld = (f, bytes) => [...vi(f * 8 + 2), ...vi(bytes.length), ...bytes];
const str = (f, s) => ld(f, [...Buffer.from(s)]);
const view = (slot, item) => ld(10, [...(slot ? uv(1, slot) : []), ...uv(2, item)]);
const player = ({ id, title, views = [], name = 'p' + id }) => [
  ...uv(1, id), ...uv(2, 400101), ...(title === null ? [] : uv(3, title)), ...str(4, name),
  ...ld(6, [...uv(1, 200001), ...uv(5, 400102)]), ...views.flatMap(([s, i]) => view(s, i))];
const authPayload = ({ players, seats = true, packed = true, robots = [] }) => [
  ...players.flatMap(p => ld(2, player(p))),
  ...(!seats ? [] : packed ? ld(3, players.flatMap(p => vi(p.id))) : players.flatMap(p => uv(3, p.id))),
  ...ld(5, [...uv(1, 4), ...str(2, 'cfg')]), ...robots.flatMap(p => ld(7, player(p)))];
const envelope = (type, msgId, method, payload) => Uint8Array.from([type, msgId & 255, msgId >> 8, ...ld(1, [...Buffer.from(method)]), ...ld(2, payload)]);
const range = b => {
  let i = 3, hit;
  const read = () => { let n = 0, m = 1; for (; b[i] & 128; m *= 128) n += (b[i++] & 127) * m; return n + b[i++] * m; };
  while (i < b.length) {
    const tag = b[i++], len = read();
    if (tag === 0x12) hit = { from: i, to: i + len };
    i += len;
  }
  return hit;
};

const ME = 111;
const ids = [ME, 222, 333, 444];
const others = (title, views) => ids.slice(1).map(id => ({ id, title, views }));
const mkPlayers = ({ title = 300, views = [[1, 1000], [2, 1000]], n = 4, at = 0 } = {}) => {
  const list = ids.slice(0, n).map(id => ({ id, title, views }));
  list.splice(at, 0, list.splice(0, 1)[0]);
  return list;
};
const withMe = (players, patch) => players.map(p => p.id === ME ? { ...p, ...patch } : p);
const REWRITTEN = { title: 400, views: [[1, 1000], [2, 2000]] };
const SETTINGS = { enabled: true, testAccountAck: true, titleId: 400, views: '2=2000' };

function setup(settings = SETTINGS, { canReplace = true } = {}) {
  let spec;
  const logs = [];
  vm.runInNewContext(source, { window: { __nakiPlugins: { register(s) { spec = s; } } }, Number, Object, Math });
  const mk = (b, method, type) => {
    const ctx = { direction: type === 2 ? 'send' : 'receive', type, method, bytes: b, payload: range(b), isNaki: rig.naki, settings, log: m => logs.push(m) };
    if (canReplace) ctx.replace = nb => nb.length === b.length && (b.set(nb), calls.push(Array.from(nb)), true);
    return ctx;
  };
  const calls = [];
  const rig = {
    spec, logs, calls, naki: false,
    login: (id = ME, method = '.lq.Lobby.login') => spec.onReceive(mk(envelope(3, 1, method, [...(id === null ? ld(1, uv(1, 2500)) : uv(2, id)), ...ld(3, uv(1, 999))]), method, 3)),
    notify: method => spec.onReceive(mk(envelope(1, 0, method, []), method, 1)),
    request: (id = ME) => spec.onSend(mk(envelope(2, 7, '.lq.FastTest.authGame', [...uv(1, id), ...str(2, 'tok')]), '.lq.FastTest.authGame', 2)),
    auth(payload, edit) {
      const b = envelope(3, 7, '.lq.FastTest.authGame', payload);
      const before = Array.from(b);
      spec.onReceive(mk(edit ? edit(b) : b, '.lq.FastTest.authGame', 3));
      return { bytes: Array.from(b), before };
    },
    ready(id = ME) { rig.login(id); rig.request(id); },
    play(opts, id = ME) {
      rig.ready(id);
      return rig.auth(authPayload(opts));
    },
  };
  return rig;
}
const unchanged = out => assert.deepEqual(out.bytes, out.before);
const expected = opts => Array.from(envelope(3, 7, '.lq.FastTest.authGame', authPayload(opts)));

test('title and view with equal varint length: only the own entry changes, nothing else', () => {
  for (const [n, seats, packed, at] of [[4, true, true, 0], [4, true, false, 2], [3, true, true, 1], [4, false, true, 3]]) {
    const rig = setup();
    const players = mkPlayers({ n, at });
    const out = rig.play({ players, seats, packed });
    const want = withMe(players, REWRITTEN);
    assert.equal(rig.calls.length, 1);
    assert.deepEqual(out.bytes, expected({ players: want, seats, packed }));
    assert.equal(out.bytes.length, out.before.length);
  }
});
test('own entry is identified by account_id, not by position; others and robots stay identical', () => {
  const rig = setup();
  const players = mkPlayers({ at: 3 });
  const robots = [{ id: 5, title: 300, views: [[2, 1000]] }];
  const out = rig.play({ players, robots });
  const want = withMe(players, REWRITTEN);
  assert.deepEqual(out.bytes, expected({ players: want, robots }));
});
test('seat_list, account_id and nickname bytes are unchanged after a rewrite', () => {
  const rig = setup();
  const players = mkPlayers();
  const out = rig.play({ players });
  const seat = Buffer.from(ld(3, ids.flatMap(vi))).toString('hex');
  assert.ok(Buffer.from(out.bytes).toString('hex').includes(seat));
  for (const p of players) {
    assert.ok(Buffer.from(out.bytes).toString('hex').includes(Buffer.from([...uv(1, p.id), ...uv(2, 400101)]).toString('hex')));
    assert.ok(Buffer.from(out.bytes).toString('hex').includes(Buffer.from(str(4, 'p' + p.id)).toString('hex')));
  }
  assert.notDeepEqual(out.bytes, out.before);
});
test('varint length differs: that item is skipped, the other still changes, a log line is written', () => {
  const rig = setup({ ...SETTINGS, titleId: 16384 });
  const players = mkPlayers({ title: 16383 });
  const out = rig.play({ players });
  assert.deepEqual(out.bytes, expected({ players: withMe(players, { views: REWRITTEN.views }) }));
  assert.ok(rig.logs.some(l => l.includes('稱號') && l.includes('長度不同')));
});
test('no rewrite at all when every new value crosses a varint length boundary', () => {
  for (const [title, titleId, slot2, views] of [[16383, 16384, 1000, '2=1000000'], [100, 200, 100, '2=2000'], [300, 100, 1000, '2=100']]) {
    const rig = setup({ ...SETTINGS, titleId, views });
    const players = mkPlayers({ title, views: [[1, 1000], [2, slot2]] });
    const out = rig.play({ players });
    assert.equal(rig.calls.length, 0);
    unchanged(out);
  }
});
test('missing title field or missing slot: not rewritten, logged', () => {
  const rig = setup();
  const out = rig.play({ players: mkPlayers({ title: null, views: [[1, 1000]] }) });
  assert.equal(rig.calls.length, 0);
  unchanged(out);
  assert.ok(rig.logs.some(l => l.includes('稱號 欄位不存在')));
  assert.ok(rig.logs.some(l => l.includes('slot 2')));
});
test('enabled or testAccountAck false: no rewrite and no state kept', () => {
  for (const settings of [{ ...SETTINGS, testAccountAck: false }, { ...SETTINGS, enabled: false }, {}, { ...SETTINGS, testAccountAck: 'true' }]) {
    const rig = setup(settings);
    const out = rig.play({ players: mkPlayers() });
    assert.equal(rig.calls.length, 0);
    unchanged(out);
  }
});
test('incomplete or invalid settings: no rewrite', () => {
  for (const patch of [{ titleId: 0, views: '' }, { titleId: 1.5, views: '' }, { titleId: -3, views: ' ' }, { titleId: 400, views: 'abc' },
    { titleId: 400, views: '2=2000,2=2001' }, { titleId: 400, views: '2=0' }, { titleId: 400, views: '2=5000000000' }, { titleId: 400, views: 7 }]) {
    const rig = setup({ ...SETTINGS, ...patch });
    const out = rig.play({ players: mkPlayers() });
    assert.equal(rig.calls.length, 0, JSON.stringify(patch));
    unchanged(out);
  }
});
test('title only, and view only settings each rewrite just their own field', () => {
  let rig = setup({ ...SETTINGS, views: '' });
  let players = mkPlayers();
  assert.deepEqual(rig.play({ players }).bytes, expected({ players: withMe(players, { title: 400 }) }));
  rig = setup({ ...SETTINGS, titleId: 0 });
  assert.deepEqual(rig.play({ players }).bytes, expected({ players: withMe(players, { views: REWRITTEN.views }) }));
});
test('identity: login id differs from authGame request id, or either is missing: no rewrite', () => {
  let rig = setup();
  rig.login(ME); rig.request(222);
  let out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
  rig = setup();
  rig.request(ME);
  out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
  rig = setup();
  rig.login(ME);
  out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
  rig = setup();
  rig.login(ME); rig.request(ME);
  rig.spec.onReceive({ method: '.lq.Lobby.login', type: 3, bytes: envelope(3, 1, '.lq.Lobby.login', ld(3, uv(1, ME))), payload: null, settings: SETTINGS, log() {} });
  out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
  assert.equal(rig.calls.length, 0);
});
test('login id not present in players: no rewrite; duplicated own entry: no rewrite', () => {
  let rig = setup();
  let out = rig.play({ players: mkPlayers() }, 999);
  unchanged(out);
  rig = setup();
  out = rig.play({ players: [...mkPlayers(), { id: ME, title: 300, views: [[2, 1000]] }] });
  unchanged(out);
  assert.equal(rig.calls.length, 0);
});
test('the request pairs with one authGame response only', () => {
  const rig = setup();
  rig.play({ players: mkPlayers() });
  const out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
  assert.equal(rig.calls.length, 1);
});
test('another login, oauth2/email login and logout notifications reset identity as expected', () => {
  let rig = setup();
  rig.login(ME, '.lq.Lobby.oauth2Login'); rig.request();
  assert.notDeepEqual(rig.auth(authPayload({ players: mkPlayers() })).bytes, expected({ players: mkPlayers() }));
  for (const method of ['.lq.NotifyAnotherLogin', '.lq.NotifyAccountLogout']) {
    rig = setup();
    rig.login(); rig.notify(method); rig.request();
    const out = rig.auth(authPayload({ players: mkPlayers() }));
    unchanged(out);
    rig.ready();
    assert.notDeepEqual(rig.auth(authPayload({ players: mkPlayers() })).bytes, out.before);
  }
  rig = setup();
  rig.login(ME, '.lq.Lobby.emailLogin'); rig.request();
  rig.auth(authPayload({ players: mkPlayers() }));
  assert.equal(rig.calls.length, 1);
});
test('a failed login (no account_id) clears the previous identity', () => {
  const rig = setup();
  rig.login(); rig.login(null);
  rig.request();
  const out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
});
test('Naki traffic is ignored everywhere: not learned, not rewritten', () => {
  let rig = setup();
  rig.naki = true;
  let out = rig.play({ players: mkPlayers() });
  unchanged(out);
  rig = setup();
  rig.ready();
  rig.naki = true;
  const res = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(res);
  assert.equal(rig.calls.length, 0);
  rig = setup();
  rig.ready();
  rig.naki = true; rig.request(222); rig.login(222); rig.notify('.lq.NotifyAccountLogout'); rig.naki = false;
  out = rig.auth(authPayload({ players: mkPlayers() }));
  assert.equal(rig.calls.length, 1);
});
test('missing ctx.replace: no rewrite, no throw', () => {
  const rig = setup(SETTINGS, { canReplace: false });
  const out = rig.play({ players: mkPlayers() });
  unchanged(out);
});
test('truncated payloads, wire type mismatch, unknown wire types: no rewrite, no throw', () => {
  const good = authPayload({ players: mkPlayers() });
  const cases = {
    truncated: good.slice(0, good.length - 3),
    badWire: [...good, 0x0b],
    overlongVarint: [...good, 0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f],
    truncatedPlayer: [...vi(2 * 8 + 2), 40, ...uv(1, ME)],
    idAsBytes: ld(2, [...ld(1, [ME]), ...uv(3, 300), ...view(2, 1000)]),
  };
  for (const [name, payload] of Object.entries(cases)) {
    const rig = setup();
    rig.ready();
    const res = rig.auth(payload);
    assert.deepEqual(res.bytes, res.before, name);
    assert.equal(rig.calls.length, 0, name);
  }
});
test('own entry with wrong wire type for title or view fields: no rewrite at all', () => {
  for (const mine of [
    [...uv(1, ME), ...ld(3, [1, 2]), ...view(2, 1000)],
    [...uv(1, ME), ...uv(3, 300), ...uv(10, 5)],
    [...uv(1, ME), ...uv(3, 300), ...ld(10, [...ld(1, [1]), ...uv(2, 1000)])],
    [...uv(1, ME), ...uv(3, 300), ...ld(10, [0x0b])],
  ]) {
    const rig = setup();
    rig.ready();
    const out = rig.auth(ld(2, mine));
    unchanged(out);
    assert.equal(rig.calls.length, 0);
  }
});
test('after onDisable nothing is rewritten, and onDisable does not throw', () => {
  const rig = setup();
  rig.ready();
  rig.spec.onDisable({ log() {} });
  rig.ready();
  const out = rig.auth(authPayload({ players: mkPlayers() }));
  unchanged(out);
  assert.equal(rig.calls.length, 0);
});
test('a replace refused by Naki is logged and nothing else is attempted', () => {
  const rig = setup();
  rig.ready();
  const b = envelope(3, 7, '.lq.FastTest.authGame', authPayload({ players: mkPlayers() }));
  const before = Array.from(b);
  rig.spec.onReceive({ method: '.lq.FastTest.authGame', type: 3, bytes: b, payload: range(b), settings: SETTINGS, replace: () => false, log: m => rig.logs.push(m) });
  assert.deepEqual(Array.from(b), before);
  assert.ok(rig.logs.some(l => l.includes('replace 被拒')));
});
test('slot 0 is the view whose slot field is omitted', () => {
  const rig = setup({ ...SETTINGS, titleId: 0, views: '0=2000' });
  const players = mkPlayers({ views: [[0, 1000], [2, 1000]] });
  const out = rig.play({ players });
  assert.deepEqual(out.bytes, expected({ players: withMe(players, { views: [[0, 2000], [2, 1000]] }) }));
});

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
const html = fs.readFileSync(path.join(dir, 'settings.html'), 'utf8');
const pluginSource = fs.readFileSync(path.join(dir, 'plugin.js'), 'utf8');
const WARNING = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8').match(/^> (本插件只改你這台裝置.*)$/m);
const plain = s => s.replace(/<[^>]+>/g, '').replace(/\*\*/g, '');

test('manifest: minimal capability and methods, CC0, empty defaults, settings page declared', () => {
  assert.equal(manifest.id, 'naki-plugin-ex-local-unlock');
  assert.deepEqual(manifest.capabilities, ['rewriteReceive']);
  assert.deepEqual(manifest.methods, ['.lq.Lobby.login', '.lq.Lobby.oauth2Login', '.lq.Lobby.emailLogin',
    '.lq.FastTest.authGame', '.lq.NotifyAnotherLogin', '.lq.NotifyAccountLogout']);
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.settingsUI, 'settings.html');
  assert.deepEqual(Object.entries(manifest.settings).map(([k, v]) => [k, v.type, v.default]),
    [['enabled', 'boolean', false], ['testAccountAck', 'boolean', false], ['titleId', 'number', 0], ['views', 'string', '']]);
});
test('plugin.js sends nothing, stores nothing and hard-codes no id', () => {
  assert.doesNotMatch(pluginSource, /rewriteSend|injectSend|sendRequest|sendRaw|__nakiWebSocket|respondLocally|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/);
  assert.deepEqual((pluginSource.match(/\d{4,}/g) || []).filter(n => !['4294967295', '16384', '2097152', '268435456'].includes(n)), []);
});
test('settings page: only window.naki get/set on schema keys, no network or external resources', () => {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const members = [...script.matchAll(/window\.naki\.(\w+)/g)].map(m => m[1]);
  assert.ok(members.length > 0 && members.every(m => m === 'get' || m === 'set'), members.join());
  const setKeys = [...script.matchAll(/(?:save|window\.naki\.set)\(\s*'([^']+)'/g)].map(m => m[1]);
  for (const key of setKeys) assert.ok(manifest.settings[key], 'key not in schema: ' + key);
  assert.deepEqual([...new Set(setKeys)].sort(), Object.keys(manifest.settings).sort());
  assert.equal([...script.matchAll(/window\.naki\.set\(\s*(?!')/g)].length, 1);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(|@import|https?:|<link|<iframe|<img[^>]*src|<script[^>]*src|url\(/i);
});
test('settings page: warning text equals README and ack gates the controls', () => {
  assert.ok(WARNING, 'README has the warning block');
  const page = plain(html.match(/<p id="warn">([\s\S]*?)<\/p>/)[1]);
  assert.equal(page, plain(WARNING[1]));
  assert.match(html, /<fieldset id="controls" disabled>/);
  assert.match(html, /\$\('controls'\)\.disabled = !\$\('ack'\)\.checked/);
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.ok(readme.includes(WARNING[1]));
});
test('settings page: saving views and title validates before writing', async () => {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  const el = () => ({ children: [], dataset: {}, style: {}, append(c) { this.children.push(c); }, set textContent(v) { this.children = []; this._t = v; }, get textContent() { return this._t; } });
  const document = { getElementById: id => els[id] || (els[id] = el()), createElement: el };
  const written = [];
  const naki = { get: () => Promise.resolve({ enabled: false, testAccountAck: true, titleId: 12, views: '1=10,2=20' }), set: (k, v) => (written.push([k, v]), Promise.resolve()) };
  vm.runInNewContext(script, { document, window: { naki }, Number, Promise });
  await new Promise(r => setImmediate(r));
  assert.equal(els.title.value, '12');
  assert.equal(els.controls.disabled, false);
  assert.equal(els.rows.children.length, 2);
  els.title.value = '1.5'; els.title.onchange();
  els.title.value = '99'; els.title.onchange();
  const row = els.rows.children[0];
  row.children[1].value = '0'; row.children[1].onchange();
  row.children[1].value = '30'; row.children[1].onchange();
  els.rows.children[1].children[0].value = '1'; els.rows.children[1].children[0].onchange();
  els.rows.children[1].children[0].value = '5'; els.rows.children[1].children[0].onchange();
  els.ack.checked = false; els.ack.onchange();
  assert.deepEqual(written, [['titleId', 99], ['views', '1=30,2=20'], ['views', '1=30,5=20'], ['testAccountAck', false]]);
  assert.equal(els.controls.disabled, true);
});
