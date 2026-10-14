(function () {
  'use strict';
  var LOGIN = ['.lq.Lobby.login', '.lq.Lobby.oauth2Login', '.lq.Lobby.emailLogin'];
  var LOGOUT = ['.lq.NotifyAnotherLogin', '.lq.NotifyAccountLogout'];
  var AUTH = '.lq.FastTest.authGame';
  var MAX = 4294967295;
  var selfId = 0, authReq = 0, alive = true;

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

  // visit(field, wire, from, to, value)：wire 0 的 from/to 是 varint 位元組範圍，wire 2 是內容範圍。結構損壞回 false。
  function walk(b, from, to, visit) {
    var i = from;
    while (i < to) {
      var tag = readVarint(b, i, to);
      if (!tag) return false;
      var field = Math.floor(tag[0] / 8), wire = tag[0] & 7, end, v;
      i = tag[1];
      if (wire === 0) {
        v = readVarint(b, i, to);
        if (!v) return false;
        end = v[1];
        visit(field, 0, i, end, v[0]);
      } else if (wire === 2) {
        v = readVarint(b, i, to);
        if (!v || v[1] + v[0] > to) return false;
        i = v[1];
        end = i + v[0];
        visit(field, 2, i, end, 0);
      } else if (wire === 1 || wire === 5) {
        end = i + (wire === 1 ? 8 : 4);
        if (end > to) return false;
      } else return false;
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

  // 欄位恰好出現一次才回傳其值，否則 0（視為未知）。
  function only(spans) { return spans && spans.length === 1 ? spans[0].value : 0; }
  function idOf(ctx, field) {
    return ctx.payload ? only(collect(ctx.bytes, ctx.payload.from, ctx.payload.to, field, 0)) : 0;
  }
  function isOn(s) { return !!s && s.enabled === true && s.testAccountAck === true; }

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
    var titleId = Number.isInteger(s.titleId) && s.titleId >= 1 && s.titleId <= MAX ? s.titleId : 0;
    return titleId || Object.keys(views).length ? { titleId: titleId, views: views } : null;
  }

  // 玩家內的裝扮項目，依 slot 分組（省略 slot 欄位＝slot 0）。結構損壞回 null。
  function viewItems(b, me) {
    var views = collect(b, me.from, me.to, 10, 2), items = {};
    if (!views) return null;
    for (var i = 0; i < views.length; i++) {
      var slot = collect(b, views[i].from, views[i].to, 1, 0), item = collect(b, views[i].from, views[i].to, 2, 0);
      if (!slot || !item || slot.length > 1) return null;
      var n = slot.length ? slot[0].value : 0;
      items[n] = (items[n] || []).concat(item);
    }
    return items;
  }

  // 只改寫 varint 位元組長度不變的欄位，其餘封包位元組原樣保留。
  function planEdits(name, spans, value, edits, log) {
    if (!spans.length) return log(name + ' 欄位不存在，略過');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].to - spans[i].from !== varintSize(value)) return log(name + ' varint 長度不同，略過');
    }
    spans.forEach(function (s) { edits.push({ from: s.from, to: s.to, value: value }); });
  }

  function applyEdits(b, edits) {
    var out = b.slice();
    edits.forEach(function (e) {
      var v = e.value, k = e.from;
      for (; v > 127; v = Math.floor(v / 128)) out[k++] = (v % 128) | 128;
      out[k] = v;
    });
    return out;
  }

  function rewriteAuth(ctx, cfg, req) {
    var b = ctx.bytes, log = ctx.log, p = ctx.payload, edits = [];
    if (!selfId || req !== selfId) return log('自家身分未確認，不改寫');
    var players = collect(b, p.from, p.to, 2, 2);
    if (!players) return log('authGame 結構不符，不改寫');
    var mine = players.filter(function (pl) { return only(collect(b, pl.from, pl.to, 1, 0)) === selfId; });
    if (mine.length !== 1) return log('找不到唯一的自家玩家，不改寫');
    var me = mine[0];
    if (cfg.titleId) {
      var title = collect(b, me.from, me.to, 3, 0);
      if (!title) return log('稱號欄位結構不符，不改寫');
      planEdits('稱號', title, cfg.titleId, edits, log);
    }
    var slots = Object.keys(cfg.views);
    if (slots.length) {
      var items = viewItems(b, me);
      if (!items) return log('裝扮欄位結構不符，不改寫');
      slots.forEach(function (slot) { planEdits('裝扮 slot ' + slot, items[slot] || [], cfg.views[slot], edits, log); });
    }
    if (!edits.length) return;
    log(ctx.replace(applyEdits(b, edits)) ? '已改寫 ' + edits.length + ' 項' : 'replace 被拒，不改寫');
  }

  window.__nakiPlugins.register({
    id: 'naki-plugin-ex-local-unlock',
    onSend: function (ctx) {
      if (!alive || ctx.isNaki || !isOn(ctx.settings) || ctx.method !== AUTH || ctx.type !== 2 || !ctx.payload) return;
      authReq = idOf(ctx, 1);
    },
    onReceive: function (ctx) {
      if (!alive || ctx.isNaki || !isOn(ctx.settings)) return;
      var m = ctx.method;
      if (LOGOUT.indexOf(m) !== -1) { selfId = authReq = 0; return; }
      if (LOGIN.indexOf(m) !== -1) {
        authReq = 0;
        selfId = idOf(ctx, 2);
        return;
      }
      if (m !== AUTH || ctx.type !== 3) return;
      var req = authReq;
      authReq = 0;
      var cfg = parseSettings(ctx.settings, ctx.log);
      if (cfg && ctx.payload && typeof ctx.replace === 'function') rewriteAuth(ctx, cfg, req);
    },
    onDisable: function () { alive = false; selfId = authReq = 0; }
  });
})();
