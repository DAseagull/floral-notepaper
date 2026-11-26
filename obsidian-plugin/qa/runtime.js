'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Plugin } = require('obsidian');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(message);
}

module.exports = class RuntimeCheck extends Plugin {
  onload() { this.app.workspace.onLayoutReady(() => setTimeout(() => void this.check(), 1200)); }

  async check() {
    const target = path.join(this.app.vault.adapter.getBasePath(), 'runtime-result.json');
    const result = { electron: process.versions.electron, checks: [], started: Date.now() };
    const vault = this.app.vault;
    const plugin = this.app.plugins.plugins['floral-desk'];
    const exec = (surface, source) => surface.win.webContents.executeJavaScript(source);
    const mark = async (name) => {
      result.checks.push(name);
      await fs.writeFile(target, JSON.stringify(result, null, 2));
    };
    const find = (role) => [...plugin.surfaces].find((surface) => surface.role === role);
    const click = (surface, id) => exec(surface, `document.getElementById(${JSON.stringify(id)}).click(); null`);
    const input = (surface, text) => exec(surface, `(() => { const field=document.getElementById('editor'); field.value=${JSON.stringify(text)}; field.dispatchEvent(new Event('input')); })()`);
    const alpha = (surface, value) => exec(surface, `(() => { const field=document.getElementById('alpha'); field.value=${value}; field.dispatchEvent(new Event('change')); })()`);
    async function fixture(name, text) {
      const existing = vault.getAbstractFileByPath(name);
      if (existing) { await vault.modify(existing, text); return existing; }
      return vault.create(name, text);
    }
    const metrics = () => plugin.remote.app.getAppMetrics().map((item) => ({ type: item.type, cpu: item.cpu, memory: item.memory }));
    try {
      assert.ok(plugin, 'Plugin must load');
      result.runtime = { assetDir: plugin.assetDir, registered: Object.fromEntries(plugin.shortcuts), hasRemote: Boolean(plugin.remote) };
      assert.ok(plugin.assetDir, 'Plugin must resolve its asset directory');
      if (!plugin.shortcuts.has('quickShortcut')) {
        assert.equal(plugin.registerShortcut('quickShortcut', 'Ctrl+Alt+Space'), true, 'Neither quick shortcut could be registered');
      }
      if (!plugin.shortcuts.has('imageShortcut')) {
        assert.equal(plugin.registerShortcut('imageShortcut', 'Ctrl+Alt+Shift+V'), true, 'Neither screenshot shortcut could be registered');
      }
      result.runtime.registered = Object.fromEntries(plugin.shortcuts);
      result.beforeWindows = metrics();
      await mark('Both Windows shortcuts registered');
      const main = plugin.remote.getCurrentWindow();
      main.minimize();
      await until(() => main.isMinimized(), 'Main window did not minimize');
      const start = performance.now();
      await plugin.toggleQuick();
      await until(() => find('quick') && exec(find('quick'), '!document.querySelector("textarea").hidden'), 'Quick editor did not open');
      const quick = find('quick');
      result.quickWindow = { visible: quick.win.isVisible(), top: quick.win.isAlwaysOnTop(), minimized: main.isMinimized(), bounds: quick.win.getBounds() };
      await mark('Quick editor renderer loaded');
      result.quickOpenMs = Math.round(performance.now() - start);
      assert.equal(quick.win.isAlwaysOnTop(), true);
      assert.equal(main.isMinimized(), true);
      await mark('Quick editor floats with the Obsidian main window minimized');
      await input(quick, '# 中文便签\n第一行内容\n第二行内容');
      await until(() => quick.file && quick.savedText.includes('第二行内容'), 'Quick draft was not saved');
      assert.equal(await vault.read(quick.file), '# 中文便签\n第一行内容\n第二行内容');
      assert.ok(quick.file.path.startsWith('笔记/便签/'));
      await alpha(quick, 100);
      await until(() => plugin.settings.quickAlpha === 100, 'Quick window alpha did not update');
      assert.equal((await quick.win.webContents.capturePage({ x: 0, y: 100, width: 2, height: 2 })).toBitmap()[3], 0);
      await mark('Chinese Markdown saved in the vault and quick window background captures as alpha zero');
      await click(quick, 'pin');
      await until(() => find('note') && !find('quick'), 'Pinning the quick draft did not transition');
      const note = find('note');
      await until(() => exec(note, 'document.getElementById("preview").textContent.includes("第二行内容")'), 'Markdown preview did not render');
      const second = await fixture('测试便签二.md', '# 第二张便签\n独立透明度');
      await plugin.openNote(second);
      const another = [...plugin.surfaces].find((surface) => surface.file === second);
      await alpha(note, 100);
      await alpha(another, 53);
      await until(() => plugin.settings.notes[note.file.path]?.alpha === 100 && plugin.settings.notes[second.path]?.alpha === 53, 'Per-note transparency did not persist');
      const after = await note.win.webContents.capturePage();
      const bits = after.toBitmap();
      assert.equal(bits[3], 0);
      let visibleText = 0;
      for (let pixel = 3; pixel < bits.length; pixel += 4) if (bits[pixel] === 255) visibleText++;
      assert.ok(visibleText > 100, 'Text must remain opaque');
      assert.equal(plugin.settings.noteAlpha, 0);
      await mark('Two notes retain independent transparencies; 100% background alpha keeps opaque text');
      const expanded = note.win.getBounds();
      await click(note, 'fold');
      await until(() => note.folded && note.win.getBounds().height === 40, 'Native fold did not shrink window');
      assert.equal(note.win.isAlwaysOnTop(), true);
      assert.ok(note.win.getBounds().width < expanded.width);
      assert.equal(another.win.getBounds().height, expanded.height);
      await click(note, 'title');
      await until(() => !note.folded, 'Title did not expand');
      assert.deepEqual(note.win.getBounds(), expanded);
      await click(note, 'fold');
      await until(() => note.folded, 'Second fold did not run');
      await click(note, 'close');
      await until(() => note.win.isDestroyed(), 'Folded note did not close');
      await plugin.openNote(note.file);
      const again = [...plugin.surfaces].find((surface) => surface.file === note.file);
      assert.equal(again.folded, false);
      assert.equal(again.win.isAlwaysOnTop(), true);
      await mark('Native fold, title click expand, and reopen expanded');
      await click(again, 'edit');
      await until(() => again.editing, 'Edit did not start');
      await vault.modify(note.file, '模拟其他窗口更新');
      await input(again, '悬浮编辑中的中文');
      await until(() => again.file !== note.file, 'Concurrent edit did not create recovery note');
      assert.equal(await vault.read(note.file), '模拟其他窗口更新');
      assert.equal(await vault.read(again.file), '悬浮编辑中的中文');
      await input(again, '保存后立即关闭');
      await click(again, 'close');
      await until(() => again.win.isDestroyed(), 'Close did not flush pending edits');
      assert.equal(await vault.read(again.file), '保存后立即关闭');
      await mark('Concurrent editing preserves both texts; closing flushes edits');
      const buffer = Buffer.alloc(360 * 210 * 4);
      for (let pixel = 0; pixel < buffer.length; pixel += 4) {
        buffer[pixel] = 37; buffer[pixel + 1] = 162; buffer[pixel + 2] = 241; buffer[pixel + 3] = 255;
      }
      const image = plugin.electron.nativeImage.createFromBitmap(buffer, { width: 360, height: 210 });
      const imageFile = path.join(vault.adapter.getBasePath(), 'runtime-fixture.png');
      await fs.writeFile(imageFile, image.toPNG());
      const imageNote = await fixture('测试图片便签.md', '# 图片便签\n![[runtime-fixture.png]]');
      await until(() => this.app.metadataCache.getFirstLinkpathDest('runtime-fixture.png', imageNote.path), 'Fixture was not indexed');
      await plugin.openNote(imageNote);
      const imageTile = [...plugin.surfaces].find((surface) => surface.file === imageNote);
      await until(() => exec(imageTile, 'document.querySelector("#preview img")?.naturalWidth === 360'), 'Local picture did not render in note');
      await plugin.pinImage(image);
      const pin = find('image');
      await until(() => exec(pin, 'document.getElementById("image").naturalWidth === 360'), 'Screenshot PNG did not render');
      assert.equal(pin.win.isAlwaysOnTop(), true);
      assert.equal(pin.win.isFocused(), false);
      result.windowsOpen = metrics();
      const saved = path.join(vault.adapter.getBasePath(), 'runtime-saved.png');
      const remote = plugin.remote;
      plugin.remote = { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: saved }) } };
      try { await plugin.handleAction(pin, 'save-png'); }
      finally { plugin.remote = remote; }
      assert.deepEqual(await fs.readFile(saved), image.toPNG());
      const original = pin.win.getBounds();
      await click(pin, 'larger');
      await until(() => pin.win.getBounds().width > original.width, 'Pin did not resize');
      await exec(pin, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'})); null`);
      await until(() => !find('image'), 'Escape did not remove image');
      assert.equal(pin.png, null);
      await mark('Native image pin is topmost, leaves focus alone, scales and releases PNG on close');
      for (let i = 0; i < 8; i++) {
        await plugin.pinImage(image);
        await plugin.closeSurface(find('image'));
      }
      await until(() => !find('image'), 'Pin churn left windows behind');
      for (const surface of [...plugin.surfaces]) await plugin.closeSurface(surface);
      await until(() => plugin.surfaces.size === 0, 'Windows remained after closing');
      await sleep(1000);
      result.afterChurn = metrics();
      await mark('Eight additional pin open/close cycles; all windows released');
      main.restore();
      await this.app.workspace.getLeaf(false).openFile(second);
      // Compare the same quiet vault window, with community plugin registration toggled.
      await sleep(1600);
      metrics();
      await sleep(2600);
      result.idleEnabled = metrics();
      await this.app.plugins.disablePlugin('floral-desk');
      assert.equal(plugin.shortcuts.size, 0);
      await sleep(1600);
      metrics();
      await sleep(2600);
      result.idleDisabled = metrics();
      await this.app.plugins.enablePlugin('floral-desk');
      await mark('Plugin disable releases hotkeys; sampled idle with and without plugin in the same vault');
      result.success = true;
    } catch (error) {
      result.error = String(error.stack || error);
    }
    await fs.writeFile(target, JSON.stringify(result, null, 2));
  }
};
