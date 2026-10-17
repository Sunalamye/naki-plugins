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

const ID = 'naki-plugin-ex-local-unlock';
const GUARD = ['changeCharacterSkin', 'changeMainCharacter', 'changeAvatar', 'useTitle', 'setRandomCharacter',
  'updateCharacterSort', 'setHiddenCharacter', 'changeCharacterView', 'changeCommonView', 'saveCommonViews',
  'useCommonView', 'setLoadingImage', 'sendGiftToCharacter', 'upgradeCharacter', 'addFinishedEnding',
  'receiveEndingReward', 'receiveCharacterRewards', 'mmoActivitySetCharacter', 'mmoActivitySetTeamMember'].map(m => '.lq.Lobby.' + m);
const PHASE4 = { capabilities: ['rewriteReceive', 'reshapeReceive'], sendGuard: GUARD };

// grant：Naki 下發給本插件的授權；null 表示舊版 Naki 沒有 Phase 4（沒有 isReshapeForbidden、grant 無 sendGuard）。
function setup(settings = SETTINGS, { canReplace = true, grant = PHASE4, replaceResult = () => true, win = {} } = {}) {
  let spec;
  const logs = [];
  win.__nakiPlugins = { register(s) { spec = s; }, ...(grant ? { isReshapeForbidden: () => false } : {}) };
  win.__nakiPluginGrants = grant ? { [ID]: grant } : {};
  vm.runInNewContext(source, { window: win, Number, Object, Math, Uint8Array, Array });
  const mk = (b, method, type) => {
    const ctx = { direction: type === 2 ? 'send' : 'receive', type, method, bytes: b, payload: range(b), isNaki: rig.naki, settings, log: m => logs.push(m) };
    if (canReplace) ctx.replace = nb => {
      if (!replaceResult(nb, b)) return false;
      calls.push(Array.from(nb));
      if (nb.length === b.length) b.set(nb);
      return true;
    };
    return ctx;
  };
  const calls = [];
  const rig = {
    spec, logs, calls, win, naki: false,
    login: (id = ME, method = '.lq.Lobby.login') => spec.onReceive(mk(envelope(3, 1, method, [...(id === null ? ld(1, uv(1, 2500)) : uv(2, id)), ...ld(3, uv(1, 999))]), method, 3)),
    notify: method => spec.onReceive(mk(envelope(1, 0, method, []), method, 1)),
    request: (id = ME) => spec.onSend(mk(envelope(2, 7, '.lq.FastTest.authGame', [...uv(1, id), ...str(2, 'tok')]), '.lq.FastTest.authGame', 2)),
    send: method => spec.onSend(mk(envelope(2, 9, method, uv(1, 1)), method, 2)),
    lobby: (method, payload) => spec.onReceive(mk(envelope(3, 8, method, payload), method, 3)),
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

// ---- v1：大廳變長改寫 ----
const CHARS = '.lq.Lobby.fetchCharacterInfo', ACCOUNT = '.lq.Lobby.fetchAccountInfo', SKIN = '.lq.Lobby.changeCharacterSkin';
const CHAR = 200005, SKIN_ID = 400501;
const V1 = { ...SETTINGS, titleId: 600002, characterId: CHAR, skinId: SKIN_ID };
const ch = (id, skin) => ld(2, [...uv(1, id), ...uv(2, 3), ...uv(5, skin)]);
const charInfo = ({ chars = [[200001, 400101]], skins = [400101], packed = true, main = 200001 } = {}) => [
  ...chars.flatMap(([id, skin]) => ch(id, skin)),
  ...(packed ? ld(3, skins.flatMap(vi)) : skins.flatMap(x => uv(3, x))), ...uv(4, main), ...uv(5, 3)];
const account = (id, { title = 0, avatar = 400101 } = {}) => [...uv(1, id), ...str(2, 'me'), ...uv(7, title), ...uv(11, 100), ...uv(13, avatar)];
const res = (method, payload) => Array.from(envelope(3, 8, method, payload));
const lobbyReady = (settings = V1, opts) => { const rig = setup(settings, opts); rig.login(); return rig; };

test('fetchCharacterInfo, character not owned: main, skin and a new character are appended; other bytes kept', () => {
  for (const packed of [true, false]) {
    const rig = lobbyReady();
    rig.lobby(CHARS, charInfo({ packed }));
    const keep = charInfo({ packed }).slice(0, -(uv(4, 200001).length + uv(5, 3).length));
    assert.deepEqual(rig.calls, [res(CHARS, [...keep, ...uv(5, 3),
      ...ld(2, [...uv(1, CHAR), ...uv(5, SKIN_ID)]), ...uv(3, SKIN_ID), ...uv(4, CHAR)])]);
    assert.ok(rig.calls[0].length > res(CHARS, charInfo()).length);
  }
});
test('fetchCharacterInfo, character owned: its skin is replaced in place and an owned skin is not duplicated', () => {
  const rig = lobbyReady();
  rig.lobby(CHARS, charInfo({ chars: [[200001, 400101], [CHAR, 400502]], skins: [400101, SKIN_ID, 400502], main: 200001 }));
  const mine = ld(2, [...uv(1, CHAR), ...uv(2, 3), ...uv(5, SKIN_ID)]);
  assert.deepEqual(rig.calls, [res(CHARS, [...ch(200001, 400101), ...mine, ...ld(3, [400101, SKIN_ID, 400502].flatMap(vi)), ...uv(5, 3), ...uv(4, CHAR)])]);
});
test('fetchAccountInfo, own account with zero title: title and avatar change length and are rewritten', () => {
  const rig = lobbyReady();
  rig.lobby(ACCOUNT, ld(2, account(ME)));
  const next = [...uv(1, ME), ...str(2, 'me'), ...uv(11, 100), ...uv(7, 600002), ...uv(13, SKIN_ID)];
  assert.deepEqual(rig.calls, [res(ACCOUNT, ld(2, next))]);
  assert.equal(rig.calls[0].length, res(ACCOUNT, ld(2, account(ME))).length + 2);
});
test('fetchAccountInfo: title only or skin only touches only that field', () => {
  let rig = lobbyReady({ ...V1, characterId: 0, skinId: 0 });
  rig.lobby(ACCOUNT, ld(2, account(ME)));
  assert.deepEqual(rig.calls, [res(ACCOUNT, ld(2, [...uv(1, ME), ...str(2, 'me'), ...uv(11, 100), ...uv(13, 400101), ...uv(7, 600002)]))]);
  rig = lobbyReady({ ...V1, titleId: 0 });
  rig.lobby(ACCOUNT, ld(2, account(ME)));
  assert.deepEqual(rig.calls, [res(ACCOUNT, ld(2, [...uv(1, ME), ...str(2, 'me'), ...uv(7, 0), ...uv(11, 100), ...uv(13, SKIN_ID)]))]);
});
test('other accounts, unknown identity, or the account missing: no rewrite', () => {
  let rig = lobbyReady();
  rig.lobby(ACCOUNT, ld(2, account(222)));
  rig.lobby(ACCOUNT, ld(2, account(222).slice(2)));
  assert.equal(rig.calls.length, 0);
  assert.deepEqual(rig.logs, []);
  rig = setup(V1);
  rig.lobby(ACCOUNT, ld(2, account(ME)));
  rig.lobby(CHARS, charInfo());
  rig.login(); rig.notify('.lq.NotifyAccountLogout');
  rig.lobby(CHARS, charInfo());
  assert.equal(rig.calls.length, 0);
});
test('error responses and malformed payloads are left alone', () => {
  const cases = [
    [CHARS, [...ld(1, uv(1, 1203)), ...charInfo()]],
    [CHARS, [...charInfo(), 0x0b]],
    [CHARS, [...charInfo(), ...ld(4, [1])]],
    [CHARS, charInfo({ chars: [[CHAR, 400501], [CHAR, 400502]] })],
    [CHARS, [...ld(2, [...uv(1, CHAR), ...ld(5, [1])]), ...uv(4, 1)]],
    [ACCOUNT, [...ld(1, uv(1, 1203)), ...ld(2, account(ME))]],
    [ACCOUNT, [...ld(2, account(ME)), ...ld(2, account(ME))]],
    [ACCOUNT, ld(2, [...uv(1, ME), ...ld(7, [1])])],
    [ACCOUNT, ld(2, [...account(ME), 0x0b])],
  ];
  for (const [method, payload] of cases) {
    const rig = lobbyReady();
    rig.lobby(method, payload);
    assert.equal(rig.calls.length, 0, method + ' ' + payload.length);
    assert.equal(rig.logs.length, 1, method + ' ' + JSON.stringify(rig.logs) + payload.length);
  }
});
test('character without skin (or the reverse) skips character and avatar, still rewrites the title', () => {
  for (const patch of [{ skinId: 0 }, { characterId: 0 }, { skinId: 1.5 }]) {
    const rig = lobbyReady({ ...V1, ...patch });
    rig.lobby(CHARS, charInfo());
    rig.lobby(ACCOUNT, ld(2, account(ME)));
    assert.deepEqual(rig.calls, [res(ACCOUNT, ld(2, [...uv(1, ME), ...str(2, 'me'), ...uv(11, 100), ...uv(13, 400101), ...uv(7, 600002)]))]);
    assert.ok(rig.logs.some(l => l.includes('同時填')));
  }
});
test('settings off, Naki traffic, or a NOTIFY/REQUEST of the method: no lobby rewrite', () => {
  for (const settings of [{ ...V1, enabled: false }, { ...V1, testAccountAck: false }]) {
    const rig = lobbyReady(settings);
    rig.lobby(CHARS, charInfo());
    assert.equal(rig.calls.length, 0);
  }
  const rig = lobbyReady();
  rig.naki = true;
  rig.lobby(CHARS, charInfo());
  rig.naki = false;
  rig.spec.onReceive({ method: CHARS, type: 1, bytes: envelope(1, 0, CHARS, charInfo()), payload: null, settings: V1, log() {}, replace() { throw new Error('no'); } });
  assert.equal(rig.calls.length, 0);
});
test('older Naki without Phase 4 or the send guard: the plugin does nothing at all and says so once', () => {
  for (const grant of [null, { capabilities: ['rewriteReceive'], sendGuard: GUARD }, { capabilities: PHASE4.capabilities },
    { capabilities: PHASE4.capabilities, sendGuard: GUARD.slice(1) }]) {
    const rig = setup(V1, { grant });
    rig.login();
    rig.lobby(CHARS, charInfo());
    rig.lobby(ACCOUNT, ld(2, account(ME)));
    const out = rig.play({ players: mkPlayers() });
    unchanged(out);
    assert.equal(rig.calls.length, 0);
    assert.equal(rig.logs.filter(l => l.includes('2.20.0')).length, 1);
  }
  const rig = setup(V1, { grant: { ...PHASE4 } });
  delete rig.win.__nakiPlugins.isReshapeForbidden;
  rig.login(); rig.lobby(CHARS, charInfo());
  assert.equal(rig.calls.length, 0);
});
test('kill-switch: a refused variable-length replace stops lobby rewrites for the page; in-game equal-length continues', () => {
  let attempts = 0;
  const rig = lobbyReady(V1, { replaceResult: (nb, b) => (attempts++, nb.length === b.length) });
  rig.lobby(CHARS, charInfo());
  assert.ok(rig.logs.some(l => l.includes('不再改大廳')));
  rig.lobby(ACCOUNT, ld(2, account(ME)));
  rig.lobby(CHARS, charInfo());
  assert.equal(attempts, 1);
  assert.equal(rig.win.__nakiLocalUnlockTouched, undefined);
  rig.request();
  const out = rig.auth(authPayload({ players: mkPlayers() }));
  assert.deepEqual(out.bytes, expected({ players: withMe(mkPlayers(), { views: REWRITTEN.views }) }));
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.win.__nakiLocalUnlockTouched, true);
});

// ---- v1：送出守衛 ----
test('guarded requests pass untouched before any rewrite, and throw after one (lobby or in-game)', () => {
  let rig = lobbyReady();
  for (const m of GUARD) assert.equal(rig.send(m), undefined);
  rig.lobby(CHARS, charInfo());
  for (const m of GUARD) assert.throws(() => rig.send(m), /拒送/);
  assert.equal(rig.send('.lq.Lobby.loginBeat'), undefined);
  rig = setup({ ...SETTINGS, titleId: 0 });
  rig.play({ players: mkPlayers() });
  assert.throws(() => rig.send(SKIN), /拒送/);
});
test('the guard survives settings off, onDisable and a hot re-enable in the same page', () => {
  const win = {};
  let rig = setup(V1, { win });
  rig.login(); rig.lobby(CHARS, charInfo());
  rig.spec.onDisable({ log() {} });
  assert.throws(() => rig.send(SKIN), /拒送/);
  rig = setup({ ...V1, enabled: false }, { win });
  assert.throws(() => rig.send(SKIN), /拒送/);
  assert.equal(setup(V1).send(SKIN), undefined);
});

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
const html = fs.readFileSync(path.join(dir, 'settings.html'), 'utf8');
const pluginSource = fs.readFileSync(path.join(dir, 'plugin.js'), 'utf8');
const WARNING = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8').match(/^> (本插件只改你這台裝置.*)$/m);
const plain = s => s.replace(/<[^>]+>/g, '').replace(/\*\*/g, '');

test('manifest: minimal capability and methods, CC0, empty defaults, settings page declared', () => {
  assert.equal(manifest.id, 'naki-plugin-ex-local-unlock');
  assert.equal(manifest.version, '1.0.0');
  assert.deepEqual(manifest.capabilities, ['rewriteReceive', 'reshapeReceive']);
  assert.deepEqual(manifest.methods, ['.lq.Lobby.login', '.lq.Lobby.oauth2Login', '.lq.Lobby.emailLogin',
    '.lq.FastTest.authGame', '.lq.NotifyAnotherLogin', '.lq.NotifyAccountLogout', CHARS, ACCOUNT, ...GUARD]);
  assert.deepEqual(manifest.sendGuard, GUARD);
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.settingsUI, 'settings.html');
  assert.deepEqual(Object.entries(manifest.settings).map(([k, v]) => [k, v.type, v.default]),
    [['enabled', 'boolean', false], ['testAccountAck', 'boolean', false], ['titleId', 'number', 0], ['views', 'string', ''],
      ['characterId', 'number', 0], ['skinId', 'number', 0]]);
});
test('plugin.js sends nothing, stores nothing and hard-codes no id', () => {
  assert.doesNotMatch(pluginSource, /rewriteSend|injectSend|sendRequest|sendRaw|__nakiWebSocket|respondLocally|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/);
  assert.deepEqual((pluginSource.match(/\d{4,}/g) || []).filter(n => !['4294967295', '16384', '2097152', '268435456'].includes(n)), []);
});
test('settings page: only window.naki get/set on schema keys, no network or external resources', () => {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const members = [...script.matchAll(/window\.naki\.(\w+)/g)].map(m => m[1]);
  assert.ok(members.length > 0 && members.every(m => m === 'get' || m === 'set'), members.join());
  const setKeys = [...script.matchAll(/save\(\s*'([^']+)'/g), ...script.matchAll(/\['\w+', '(\w+Id)'\]/g)].map(m => m[1]);
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
  assert.equal(els.characterId.value, '0');
  els.characterId.value = '-1'; els.characterId.onchange();
  els.characterId.value = '200005'; els.characterId.onchange();
  els.skinId.value = '400501'; els.skinId.onchange();
  els.ack.checked = false; els.ack.onchange();
  assert.deepEqual(written, [['titleId', 99], ['views', '1=30,2=20'], ['views', '1=30,5=20'],
    ['characterId', 200005], ['skinId', 400501], ['testAccountAck', false]]);
  assert.equal(els.controls.disabled, true);
});
