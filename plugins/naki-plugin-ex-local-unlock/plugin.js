(function () {
  'use strict';
  var ID = 'naki-plugin-ex-local-unlock';
  var LOGIN = ['.lq.Lobby.login', '.lq.Lobby.oauth2Login', '.lq.Lobby.emailLogin'];
  var LOGOUT = ['.lq.NotifyAnotherLogin', '.lq.NotifyAccountLogout'];
  var AUTH = '.lq.FastTest.authGame';
  var CHARACTERS = '.lq.Lobby.fetchCharacterInfo';
  var ACCOUNT = '.lq.Lobby.fetchAccountInfo';
  var GUARD = [
    'changeCharacterSkin', 'changeMainCharacter', 'changeAvatar', 'useTitle', 'setRandomCharacter',
    'updateCharacterSort', 'setHiddenCharacter', 'changeCharacterView', 'changeCommonView', 'saveCommonViews',
    'useCommonView', 'setLoadingImage', 'sendGiftToCharacter', 'upgradeCharacter', 'addFinishedEnding',
    'receiveEndingReward', 'receiveCharacterRewards', 'mmoActivitySetCharacter', 'mmoActivitySetTeamMember'
  ].map(function (m) { return '.lq.Lobby.' + m; });
  var MAX = 4294967295;
  // 頁面層級的狀態掛在 window：熱停用、自動移除、重新執行源碼都不重置，頁面重載才清。
  var page = window.__nakiLocalUnlock || (window.__nakiLocalUnlock = { touched: false, lobbyLocked: false });
  var selfId = 0, alive = true, warned = false, authReqs = new Map();

  function readVarint(b, i, end) {
    var n = 0, mul = 1;
    for (var k = 0; k < 5 && i < end; k++) {
      var x = b[i++];
      n += (x & 0x7f) * mul;
      if (!(x & 0x80)) return n > MAX ? null : [n, i];
      mul *= 128;
    }
    return null;
  }
  function varintSize(v) { return v < 128 ? 1 : v < 16384 ? 2 : v < 2097152 ? 3 : v < 268435456 ? 4 : 5; }
  function varint(v) {
    var out = [];
    for (; v > 127; v = Math.floor(v / 128)) out.push((v % 128) | 128);
    out.push(v);
    return out;
  }
  function varintField(f, v) { return varint(f * 8).concat(varint(v)); }
  function bytesField(f, bytes) { return varint(f * 8 + 2).concat(varint(bytes.length), bytes); }

  // visit(field, wire, from, to, value, start)：from/to 是值的位元組範圍（wire 2 為內容），start 是 tag 起點。結構損壞或 field 0 回 false。
  function walk(b, from, to, visit) {
    var i = from;
    while (i < to) {
      var start = i, tag = readVarint(b, i, to);
      if (!tag || tag[0] < 8) return false;
      var field = Math.floor(tag[0] / 8), wire = tag[0] & 7, end, v = null;
      i = tag[1];
      if (wire === 0) {
        v = readVarint(b, i, to);
        if (!v) return false;
        end = v[1];
      } else if (wire === 2) {
        v = readVarint(b, i, to);
        if (!v || v[1] + v[0] > to) return false;
        i = v[1];
        end = i + v[0];
      } else if (wire === 1 || wire === 5) {
        end = i + (wire === 1 ? 8 : 4);
        if (end > to) return false;
      } else return false;
      visit(field, wire, i, end, wire === 0 ? v[0] : 0, start);
      i = end;
    }
    return true;
  }
  // 取出某欄位的全部出現位置；結構損壞或 wire type 不符回 null。
  function collect(b, from, to, field, wire) {
    var out = [], bad = false;
    var ok = walk(b, from, to, function (f, w, s, e, v) {
      if (f !== field) return;
      if (w !== wire) bad = true;
      else out.push({ from: s, to: e, value: v });
    });
    return ok && !bad ? out : null;
  }
  // 單值欄位：至多出現一次才回出現位置，否則 null。
  function single(b, from, to, field, wire) {
    var spans = collect(b, from, to, field, wire);
    return spans && spans.length <= 1 ? spans : null;
  }
  // 結構完整且沒有 error（field 1）。
  function clean(b, from, to) {
    var errors = collect(b, from, to, 1, 2);
    return !!errors && !errors.length;
  }
  // repeated uint32 的全部值，packed 與非 packed 都讀。
  function uints(b, field) {
    var out = [], bad = false;
    var ok = walk(b, 0, b.length, function (f, w, s, e, v) {
      if (f !== field) return;
      if (w === 0) return out.push(v);
      if (w !== 2) return (bad = true);
      for (var i = s; i < e && !bad;) {
        var x = readVarint(b, i, e);
        if (x) { out.push(x[0]); i = x[1]; } else bad = true;
      }
    });
    return ok && !bad ? out : null;
  }
  // 逐欄位重組訊息 m：swap 回陣列就換成它，回 undefined 照抄原位元組。結構損壞回 null。
  function rebuild(m, swap) {
    var out = [];
    var ok = walk(m, 0, m.length, function (f, w, s, e, v, start) {
      var next = swap(f, s);
      Array.prototype.push.apply(out, next || Array.prototype.slice.call(m, start, e));
    });
    return ok ? out : null;
  }

  // 欄位恰好出現一次才回傳其值，否則 0（視為未知）。
  function only(spans) { return spans && spans.length === 1 ? spans[0].value : 0; }
  function idOf(ctx, field) {
    return ctx.payload ? only(collect(ctx.bytes, ctx.payload.from, ctx.payload.to, field, 0)) : 0;
  }
  function isOn(s) { return !!s && s.enabled === true && s.testAccountAck === true; }
  function isId(n) { return Number.isInteger(n) && n >= 1 && n <= MAX; }
  function pairKey(ctx) { return ctx.socketId + ':' + ctx.msgId; }

  // Naki 有 Phase 4 變長 replace 且送出守衛認得本插件的 sendGuard，才做任何改寫。
  function supported(log) {
    var grant = window.__nakiPluginGrants && window.__nakiPluginGrants[ID];
    var guarded = grant && grant.sendGuard || [];
    var ok = !!grant && (grant.capabilities || []).indexOf('reshapeReceive') !== -1
      && GUARD.every(function (m) { return guarded.indexOf(m) !== -1; })
      && typeof window.__nakiPlugins.isReshapeForbidden === 'function';
    if (!ok && !warned) {
      warned = true;
      log('這個 Naki 沒有變長改寫或送出守衛（需要 Naki 2.20.0 以上），本插件不做任何改寫');
    }
    return ok;
  }
  // 宿主已因本插件的大廳改寫而污染全部守衛方法：插件停用或被自動移除後，守衛仍由宿主接手。
  function hostTainted() {
    try {
      var t = window.__nakiPlugins.guardState().tainted[ID] || [];
      return GUARD.every(function (m) { return t.indexOf(m) !== -1; });
    } catch (e) { return false; }
  }

  function parseViews(text) {
    var views = {}, parts = text ? text.split(',') : [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^\s*(\d+)\s*=\s*(\d+)\s*$/.exec(parts[i]);
      var slot = m ? Number(m[1]) : -1, item = m ? Number(m[2]) : 0;
      if (slot < 0 || slot > MAX || item < 1 || item > MAX || slot in views) return null;
      views[slot] = item;
    }
    return views;
  }

  function parseSettings(s, log) {
    if (typeof s.views !== 'string') { log('views 型別無效，不改寫'); return null; }
    var views = parseViews(s.views.trim());
    if (!views) { log('views 格式無效，不改寫'); return null; }
    var titleId = isId(s.titleId) ? s.titleId : 0;
    var characterId = isId(s.characterId) ? s.characterId : 0, skinId = isId(s.skinId) ? s.skinId : 0;
    if (!characterId !== !skinId) { log('角色與皮膚 id 要同時填，略過角色與頭像'); characterId = skinId = 0; }
    return titleId || characterId || Object.keys(views).length
      ? { titleId: titleId, views: views, characterId: characterId, skinId: skinId } : null;
  }

  // 玩家內的裝扮項目，依 slot 分組（省略 slot 欄位＝slot 0）。結構損壞或單值欄位重複回 null。
  function viewItems(b, me) {
    var views = collect(b, me.from, me.to, 10, 2), items = {};
    if (!views) return null;
    for (var i = 0; i < views.length; i++) {
      var slot = single(b, views[i].from, views[i].to, 1, 0), item = single(b, views[i].from, views[i].to, 2, 0);
      if (!slot || !item) return null;
      var n = slot.length ? slot[0].value : 0;
      items[n] = (items[n] || []).concat(item);
    }
    return items;
  }

  // 對局連線只能等長：只改寫 varint 位元組長度不變的欄位，其餘封包位元組原樣保留。
  function planEdits(name, spans, value, edits, log) {
    if (!spans.length) return log(name + ' 欄位不存在，略過');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].to - spans[i].from !== varintSize(value)) return log(name + ' varint 長度不同，略過');
    }
    spans.forEach(function (s) { edits.push({ from: s.from, value: value }); });
  }

  function applyEdits(b, edits) {
    var out = b.slice();
    edits.forEach(function (e) { out.set(varint(e.value), e.from); });
    return out;
  }

  function rewriteAuth(ctx, cfg, req) {
    var b = ctx.bytes, log = ctx.log, p = ctx.payload, edits = [];
    if (!selfId || req !== selfId) return log('自家身分未確認，不改寫');
    if (!clean(b, p.from, p.to)) return log('authGame 帶錯誤或結構不符，不改寫');
    if (!hostTainted()) return log('大廳尚未改寫，Naki 未接手守衛，對局內不改寫');
    var players = collect(b, p.from, p.to, 2, 2);
    if (!players) return log('authGame 結構不符，不改寫');
    var mine = players.filter(function (pl) { return only(collect(b, pl.from, pl.to, 1, 0)) === selfId; });
    if (mine.length !== 1) return log('找不到唯一的自家玩家，不改寫');
    // 先驗完自家玩家的稱號與全部裝扮，與設定要改哪一項無關；任一不符整則不改。
    var me = mine[0], title = single(b, me.from, me.to, 3, 0), items = viewItems(b, me);
    if (!title || !items) return log('自家玩家的稱號或裝扮結構不符或重複，不改寫');
    if (cfg.titleId) planEdits('稱號', title, cfg.titleId, edits, log);
    Object.keys(cfg.views).forEach(function (slot) { planEdits('裝扮 slot ' + slot, items[slot] || [], cfg.views[slot], edits, log); });
    if (!edits.length) return;
    if (!ctx.replace(applyEdits(b, edits))) return log('replace 被拒，不改寫');
    page.touched = true;
    log('已改寫 ' + edits.length + ' 項');
  }

  // ResCharacterInfo：主角色換成設定的角色並顯示設定的皮膚；角色或皮膚不在清單就補。回陣列＝新 payload，回字串＝不改的原因。
  // 每個 Character 都要結構完整、charid 恰一筆、skin 至多一筆；任一不符整則不改。
  function rewriteCharacters(p, cfg) {
    var chars = collect(p, 0, p.length, 2, 2), skins = uints(p, 3);
    if (!clean(p, 0, p.length) || !chars || !skins || !single(p, 0, p.length, 4, 0)) return '角色資料結構不符或帶錯誤，不改寫';
    var own = [];
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i], ids = collect(p, c.from, c.to, 1, 0);
      if (!ids || ids.length !== 1 || !single(p, c.from, c.to, 5, 0)) return '角色清單有損壞或重複欄位，不改寫';
      if (ids[0].value === cfg.characterId) own.push(c);
    }
    if (own.length > 1) return '設定的角色重複，不改寫';
    var mine = own.length ? rebuild(p.subarray(own[0].from, own[0].to), function (f) { if (f === 5) return []; })
      : varintField(1, cfg.characterId);
    mine = mine.concat(varintField(5, cfg.skinId));
    var out = rebuild(p, function (f, s) {
      if (f === 4) return [];
      if (f === 2 && own.length && s === own[0].from) return bytesField(2, mine);
    });
    if (!own.length) out = out.concat(bytesField(2, mine));
    if (skins.indexOf(cfg.skinId) === -1) out = out.concat(varintField(3, cfg.skinId));
    return out.concat(varintField(4, cfg.characterId));
  }

  // ResAccountInfo：只改自家 Account 的稱號與頭像。他人的資料回空字串，靜默略過。
  function rewriteAccount(p, cfg) {
    var accounts = collect(p, 0, p.length, 2, 2);
    if (!clean(p, 0, p.length) || !accounts || accounts.length !== 1) return '帳號資料結構不符或帶錯誤，不改寫';
    var a = p.subarray(accounts[0].from, accounts[0].to), ids = collect(a, 0, a.length, 1, 0);
    if (!ids || ids.length !== 1 || !single(a, 0, a.length, 7, 0) || !single(a, 0, a.length, 13, 0)) return '帳號欄位結構不符或重複，不改寫';
    if (ids[0].value !== selfId) return '';
    var title = cfg.titleId, skin = cfg.skinId;
    var next = rebuild(a, function (f) { if ((f === 7 && title) || (f === 13 && skin)) return []; })
      .concat(title ? varintField(7, title) : [], skin ? varintField(13, skin) : []);
    return rebuild(p, function (f) { if (f === 2) return bytesField(2, next); });
  }

  // 大廳回應整包替換：envelope 只換 field 2（payload），header 與 field 1 原樣。
  function reshapeLobby(ctx, cfg) {
    var b = ctx.bytes, p = b.subarray(ctx.payload.from, ctx.payload.to);
    var payload = ctx.method === CHARACTERS
      ? (cfg.characterId ? rewriteCharacters(p, cfg) : '')
      : (cfg.titleId || cfg.skinId ? rewriteAccount(p, cfg) : '');
    if (typeof payload === 'string') return payload && ctx.log(payload);
    var bodies = collect(b, 3, b.length, 2, 2);
    var body = bodies && bodies.length === 1 && rebuild(b.subarray(3), function (f) { if (f === 2) return bytesField(2, payload); });
    if (!body) return ctx.log('envelope 結構不符，不改寫');
    if (!ctx.replace(Uint8Array.from(Array.prototype.slice.call(b, 0, 3).concat(body)))) {
      page.lobbyLocked = true;
      return ctx.log('變長 replace 被拒，本頁面不再改大廳（重新載入頁面才恢復）');
    }
    page.touched = true;
    ctx.log('已改寫 ' + ctx.method);
  }

  window.__nakiPlugins.register({
    id: ID,
    onSend: function (ctx) {
      // 改過任何一則顯示後，守衛方法一律拋錯：Naki 判 hook_threw 並本地拒送，即使 L3 開著也不原樣外送。
      if (GUARD.indexOf(ctx.method) !== -1) {
        if (page.touched) throw new Error('已改過本機顯示，拒送 ' + ctx.method + '（重新載入頁面才恢復）');
        return;
      }
      if (!alive || ctx.isNaki || !isOn(ctx.settings) || ctx.method !== AUTH || ctx.type !== 2 || !ctx.payload) return;
      authReqs.set(pairKey(ctx), idOf(ctx, 1));
    },
    onReceive: function (ctx) {
      if (!alive || ctx.isNaki || !isOn(ctx.settings) || !supported(ctx.log)) return;
      var m = ctx.method;
      if (LOGOUT.indexOf(m) !== -1) { selfId = 0; authReqs.clear(); return; }
      if (LOGIN.indexOf(m) !== -1) {
        authReqs.clear();
        selfId = ctx.payload && clean(ctx.bytes, ctx.payload.from, ctx.payload.to) ? idOf(ctx, 2) : 0;
        return;
      }
      if (ctx.type !== 3) return;
      var req = 0;
      if (m === AUTH) {
        req = authReqs.get(pairKey(ctx)) || 0;
        authReqs.delete(pairKey(ctx));
      } else if ((m !== CHARACTERS && m !== ACCOUNT) || !selfId || page.lobbyLocked) return;
      var cfg = parseSettings(ctx.settings, ctx.log);
      if (!cfg || !ctx.payload || typeof ctx.replace !== 'function') return;
      if (m === AUTH) rewriteAuth(ctx, cfg, req);
      else reshapeLobby(ctx, cfg);
    },
    onDisable: function () { alive = false; selfId = 0; authReqs.clear(); }
  });
})();
