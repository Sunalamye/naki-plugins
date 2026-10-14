const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../plugins');
const safeName = s => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith('.') && !s.includes('..');
const pages = fs.readdirSync(root).map(dir => ({ dir, manifest: JSON.parse(fs.readFileSync(path.join(root, dir, 'plugin.json'), 'utf8')) }))
  .filter(p => p.manifest.settingsUI);
test('at least one plugin ships a settings page', () => assert.ok(pages.length > 0));
for (const { dir, manifest } of pages) {
  const file = path.join(root, dir, manifest.settingsUI);
  test(dir + ': page file is a regular .html file with a safe name and a settings schema', () => {
    assert.ok(safeName(manifest.settingsUI) && manifest.settingsUI.endsWith('.html'));
    assert.ok(fs.lstatSync(file).isFile());
    assert.ok(Object.keys(manifest.settings || {}).length > 0);
  });
  test(dir + ': page only uses window.naki get/set on schema keys, with no network or external resources', () => {
    const html = fs.readFileSync(file, 'utf8');
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    const schema = manifest.settings;
    const members = [...script.matchAll(/window\.naki\.(\w+)/g)].map(m => m[1]);
    assert.ok(members.length > 0);
    assert.ok(members.every(m => m === 'get' || m === 'set'), members.join());
    const setKeys = [...script.matchAll(/(?:save|window\.naki\.set)\(\s*'([^']+)'/g)].map(m => m[1]);
    assert.ok(setKeys.length > 0);
    for (const key of setKeys) assert.ok(schema[key], 'key not in schema: ' + key);
    const dynamic = [...script.matchAll(/window\.naki\.set\(\s*(?!')/g)];
    assert.equal(dynamic.length, 1, 'only the save() wrapper may pass a variable key');
    for (const key of Object.keys(schema)) assert.ok(script.includes("'" + key + "'") || /\.get\(\)/.test(script), key);
    assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(|@import|https?:|<link|<iframe|<img[^>]*src|<script[^>]*src|url\(/i);
  });
}
test('tile-highlighter page: an unknown color value falls back to green like plugin.js', async () => {
  const html = fs.readFileSync(path.join(root, 'naki-plugin-ex-tile-highlighter/settings.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const el = () => ({ children: [], dataset: {}, style: {}, attrs: {}, append(c) { this.children.push(c); }, setAttribute(k, v) { this.attrs[k] = String(v); } });
  const swatches = el(), hand = el(), dim = el();
  const document = {
    getElementById: () => el(),
    createElement: el,
    querySelectorAll: sel => sel === '#swatches button' ? swatches.children : sel === '#hand span' ? hand.children : [],
  };
  const naki = { get: () => Promise.resolve({ color: 'yellow', dimOthers: true }), set: () => Promise.resolve() };
  require('node:vm').runInNewContext(script, { document, window: { naki }, swatches, hand, dim });
  await new Promise(r => setImmediate(r));
  const pressed = swatches.children.filter(b => b.attrs['aria-pressed'] === 'true').map(b => b.dataset.color);
  assert.deepEqual(pressed, ['green']);
  assert.equal(hand.children[2].style.background, 'rgba(115,255,128,1)');
});
