'use strict';

const { Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } = require('obsidian');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const actionChannel = 'floral-desk:action';
const stateChannel = 'floral-desk:state';
const defaultSettings = {
  folder: '笔记/便签',
  quickShortcut: 'Ctrl+Space',
  imageShortcut: 'Ctrl+Alt+V',
  quickAlpha: 0,
  noteAlpha: 0,
  notes: {},
};
const fallbackShortcuts = { quickShortcut: 'Ctrl+Alt+Space', imageShortcut: 'Ctrl+Alt+Shift+V' };
const maxPins = 20;
const maxPixels = 32_000_000;
const foldHeight = 40;
const imageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

function opacity(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function contain(bounds, work) {
  const width = Math.round(Math.min(bounds.width, work.width));
  const height = Math.round(Math.min(bounds.height, work.height));
  return {
    width,
    height,
    x: Math.round(Math.max(work.x, Math.min(bounds.x, work.x + work.width - width))),
    y: Math.round(Math.max(work.y, Math.min(bounds.y, work.y + work.height - height))),
  };
}

function fitImage(width, height, work, fraction = 1) {
  const scale = Math.min(1, work.width * fraction / width, work.height * fraction / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function noteStamp() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function displayTitle(surface) {
  if (surface.role === 'quick') return '快捷便签';
  const title = surface.text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/).find((line) => line.trim());
  return title?.replace(/^#{1,6}\s+/, '').trim().slice(0, 100) || surface.file?.basename || '便签';
}

class FloralSettings extends PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl, plugin } = this;
    containerEl.empty();
    const location = new Setting(containerEl).setName('新便签目录').setDesc('使用当前库中的相对路径。');
    let folderInput;
    location.addText((text) => { folderInput = text.setValue(plugin.settings.folder); });
    location.addButton((button) => button.setButtonText('保存').onClick(() => {
      const raw = folderInput.getValue().trim().replace(/\\/g, '/');
      const parts = raw.split('/');
      if (!raw || parts.some((part) => !part || part.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(part))) {
        new Notice('请输入有效的库内目录，例如 笔记/便签。');
        return;
      }
      plugin.settings.folder = normalizePath(raw);
      plugin.saveSettingsSoon();
    }));
    for (const [key, label] of [['quickShortcut', '快捷编辑'], ['imageShortcut', '剪贴板贴图']]) {
      const active = plugin.shortcuts.get(key);
      let input;
      new Setting(containerEl)
        .setName(`${label}快捷键`)
        .setDesc(active ? `已注册 ${active}。${active !== plugin.settings[key] ? '原快捷键被占用，当前使用备用键。' : ''}` : '未注册。请检查花笺、输入法或其他软件是否占用。')
        .addText((text) => { input = text.setValue(plugin.settings[key]); })
        .addButton((button) => button.setButtonText('应用').onClick(() => {
          if (plugin.registerShortcut(key, input.getValue().trim().replace(/\s+/g, ''))) {
            plugin.saveSettingsSoon();
            this.display();
          }
        }));
    }
    for (const [key, label] of [['quickAlpha', '快捷编辑窗'], ['noteAlpha', '浮窗默认']]) {
      new Setting(containerEl).setName(`${label}背景透明度`).addSlider((slider) => slider
        .setLimits(0, 100, 1).setValue(plugin.settings[key]).setDynamicTooltip().onChange((value) => {
          plugin.settings[key] = opacity(value);
          plugin.saveSettingsSoon();
          for (const surface of plugin.surfaces) if (surface.role !== 'image') plugin.updateNote(surface);
        }));
    }
  }
}

module.exports = class FloralDesk extends Plugin {
  async onload() {
    this.settings = { ...defaultSettings, ...await this.loadData() };
    this.settings.quickAlpha = opacity(this.settings.quickAlpha);
    this.settings.noteAlpha = opacity(this.settings.noteAlpha);
    this.settings.notes = Object.assign(Object.create(null), this.settings.notes);
    this.surfaces = new Set();
    this.shortcuts = new Map();
    this.lastShortcut = new Map();
    this.openNotes = new Map();
    this.settingsQueue = Promise.resolve();
    this.settingsTimer = null;
    this.pinOpening = false;
    this.stopped = false;
    this.previewId = 0;
    this.recoveryId = 0;
    this.addSettingTab(new FloralSettings(this));
    if (process.platform !== 'win32') {
      new Notice('花笺桌面便签目前支持 Windows。');
      return;
    }
    try {
      this.remote = require('@electron/remote');
      this.electron = require('electron');
      if (!this.remote.BrowserWindow || !this.remote.globalShortcut || !this.electron.clipboard) throw new Error('Electron API unavailable');
      this.assetDir = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir);
    } catch (error) {
      this.report(error, '当前 Obsidian 版本无法打开桌面浮窗。');
      return;
    }
    this.addCommand({ id: 'quick-note', name: '呼出快捷便签', callback: () => this.run(() => this.toggleQuick()) });
    this.addCommand({ id: 'pin-image', name: '固定剪贴板图片', callback: () => this.run(() => this.pinFromClipboard()) });
    this.addCommand({
      id: 'pin-note', name: '将当前笔记置顶', checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.run(() => this.openNote(file));
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem((item) => item.setTitle('钉到屏幕').setIcon('pin').onClick(() => this.run(() => this.openNote(file))));
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => this.run(() => this.refreshFile(file))));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      for (const key of Object.keys(fallbackShortcuts)) {
        const preferred = this.settings[key];
        if (!this.registerShortcut(key, preferred) && preferred === defaultSettings[key]) {
          const fallback = fallbackShortcuts[key];
          if (this.registerShortcut(key, fallback)) {
            this.settings[key] = preferred;
            new Notice(`花笺暂用 ${fallback}。释放原快捷键后可在插件设置重新应用。`);
          }
        }
      }
      this.run(() => this.restorePendingNotes());
    });
  }

  report(error, message = '花笺桌面便签未能完成操作。') {
    console.error('[floral-desk]', error);
    new Notice(message);
  }

  run(callback) {
    if (!this.stopped) Promise.resolve().then(callback).catch((error) => this.report(error));
  }

  registerShortcut(key, accelerator) {
    if (!this.remote?.globalShortcut) return false;
    const old = this.shortcuts.get(key);
    if (old === accelerator) { this.settings[key] = accelerator; return true; }
    const api = this.remote.globalShortcut;
    if (accelerator) {
      try {
        const registered = api.register(accelerator, () => {
          const now = Date.now();
          if (now - (this.lastShortcut.get(key) ?? 0) < 280) return;
          this.lastShortcut.set(key, now);
          this.run(() => key === 'quickShortcut' ? this.toggleQuick() : this.pinFromClipboard());
        });
        if (!registered) throw new Error('Shortcut is already in use');
      } catch {
        new Notice(`花笺快捷键 ${accelerator} 无法注册。可以换一个组合，或退出占用它的程序后重新应用。`);
        return false;
      }
    }
    if (old) api.unregister(old);
    if (accelerator) this.shortcuts.set(key, accelerator);
    else this.shortcuts.delete(key);
    this.settings[key] = accelerator;
    return true;
  }

  saveSettingsSoon() {
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => this.persistSettings(), 250);
  }

  persistSettings() {
    clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    const snapshot = JSON.parse(JSON.stringify(this.settings));
    this.settingsQueue = this.settingsQueue.then(() => this.saveData(snapshot)).catch((error) => this.report(error, '窗口设置保存失败。'));
  }

  onRename(file, oldPath) {
    const moved = Object.entries(this.settings.notes).filter(([name]) => name === oldPath || name.startsWith(`${oldPath}/`));
    for (const [name, style] of moved) {
      this.settings.notes[file.path + name.slice(oldPath.length)] = style;
      delete this.settings.notes[name];
    }
    if (moved.length) this.saveSettingsSoon();
  }

  workAtCursor() {
    const cursor = this.remote.screen.getCursorScreenPoint();
    return { cursor, work: this.remote.screen.getDisplayNearestPoint(cursor).workArea };
  }

  async makeWindow(surface, size) {
    const { cursor, work } = this.workAtCursor();
    const options = contain({ ...size, x: cursor.x + 14, y: cursor.y + 14 }, work);
    const win = new this.remote.BrowserWindow({
      ...options,
      title: surface.role === 'image' ? '花笺贴图' : `花笺 · ${displayTitle(surface)}`,
      show: false, frame: false, transparent: true, resizable: false, maximizable: false,
      alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', hasShadow: false,
      webPreferences: {
        preload: path.join(this.assetDir, 'preload.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, navigateOnDragDrop: false,
      },
    });
    surface.win = win;
    surface.pinned = true;
    surface.folded = false;
    this.surfaces.add(surface);
    win.webContents.on('ipc-message', (_event, channel, action, value) => {
      if (channel === actionChannel) this.run(() => this.handleAction(surface, action, value));
    });
    win.on('closed', () => {
      this.surfaces.delete(surface);
      surface.png = null;
      if (surface.file !== undefined) {
        clearTimeout(surface.saveTimer);
        if (!this.stopped) void this.flush(surface).catch((error) => this.handleSaveError(surface, error));
      }
    });
    try {
      await win.loadFile(path.join(this.assetDir, 'window.html'));
      if (this.stopped || win.isDestroyed()) return;
      if (surface.role === 'image') win.showInactive();
      else win.show();
      if (surface.pinned && !win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(false);
        win.setAlwaysOnTop(true, 'screen-saver');
      }
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw error;
    }
  }

  send(surface, state) {
    if (!surface.win?.isDestroyed()) surface.win?.webContents.send(stateChannel, { role: surface.role, ...state });
  }

  updateNote(surface, more = {}) {
    if (!surface.win || surface.win.isDestroyed()) return;
    const alpha = surface.role === 'quick' ? this.settings.quickAlpha : this.settings.notes[surface.file?.path]?.alpha ?? this.settings.noteAlpha;
    this.send(surface, {
      alpha, title: displayTitle(surface), folded: surface.folded,
      pinned: surface.pinned, editing: surface.editing, status: surface.status, ...more,
    });
  }

  async toggleQuick() {
    const existing = [...this.surfaces].find((surface) => surface.role === 'quick' && !surface.win.isDestroyed());
    if (existing) {
      if (existing.win.isFocused()) await this.closeSurface(existing);
      else {
        existing.win.show();
        existing.win.setAlwaysOnTop(true);
        this.updateNote(existing, { focus: true });
      }
      return;
    }
    if (this.quickOpening) return;
    this.quickOpening = true;
    try {
      await this.makeWindow(this.makeNote('quick', null, ''), { width: 400, height: 285 });
    } finally {
      this.quickOpening = false;
    }
  }

  makeNote(role, file, text) {
    return { role, file, text, savedText: text, editing: role === 'quick', queue: Promise.resolve() };
  }

  async openNote(file) {
    const existing = [...this.surfaces].find((surface) => surface.role === 'note' && surface.file === file && !surface.win.isDestroyed());
    if (existing) {
      if (existing.folded) this.toggleFold(existing);
      existing.pinned = true;
      existing.win.show();
      existing.win.setAlwaysOnTop(true);
      this.updateNote(existing);
      return;
    }
    if (this.openNotes.has(file)) return this.openNotes.get(file);
    const opening = (async () => {
      const text = await this.app.vault.read(file);
      if (!this.stopped) await this.makeWindow(this.makeNote('note', file, text), { width: 390, height: 290 });
    })();
    this.openNotes.set(file, opening);
    try { await opening; } finally { this.openNotes.delete(file); }
  }

  async createNote(text, prefix = '便签') {
    const vault = this.app.vault;
    const folder = normalizePath(this.settings.folder);
    let current = '';
    for (const segment of folder.split('/')) {
      current = current ? `${current}/${segment}` : segment;
      if (!vault.getAbstractFileByPath(current)) {
        try { await vault.createFolder(current); }
        catch (error) { if (!vault.getAbstractFileByPath(current)) throw error; }
      }
    }
    const name = `${prefix} ${noteStamp()}`;
    for (let i = 1; i < 1000; i++) {
      const filePath = `${folder}/${name}${i === 1 ? '' : ` (${i})`}.md`;
      if (vault.getAbstractFileByPath(filePath)) continue;
      try { return await vault.create(filePath, text); }
      catch (error) { if (!vault.getAbstractFileByPath(filePath)) throw error; }
    }
    throw new Error('Unable to allocate a note filename');
  }

  flush(surface) {
    clearTimeout(surface.saveTimer);
    surface.queue = surface.queue.catch(() => {}).then(async () => {
      const text = surface.text;
      if (text === surface.savedText) return;
      const vault = this.app.vault;
      if (!surface.file) {
        if (!text.trim()) return;
        surface.file = await this.createNote(text);
      } else {
        try {
          await vault.process(surface.file, (current) => {
            if (current !== surface.savedText) throw new Error('floral-edit-conflict');
            return text;
          });
        } catch (error) {
          if (error.message !== 'floral-edit-conflict' && vault.getAbstractFileByPath(surface.file.path) === surface.file) throw error;
          surface.file = await this.createNote(text, '便签恢复');
          surface.status = `原笔记已在别处变更，当前内容已保存至「${surface.file.basename}」。`;
        }
      }
      surface.savedText = text;
      this.updateNote(surface);
    });
    return surface.queue;
  }

  handleSaveError(surface, error) {
    surface.status = '保存失败，正文仍在编辑窗中。可复制正文，或按 Ctrl+S 重试。';
    this.updateNote(surface);
    if (surface.win?.isDestroyed()) this.writePendingNotes([surface]);
    this.report(error, '便签保存失败。');
  }

  async refreshFile(file) {
    for (const surface of this.surfaces) {
      if (surface.file !== file || surface.text !== surface.savedText || surface.editing) continue;
      const text = await this.app.vault.read(file);
      if (surface.text !== surface.savedText || surface.editing || surface.file !== file || surface.text === text) continue;
      surface.text = text;
      surface.savedText = text;
      await this.updatePreview(surface);
    }
  }

  async updatePreview(surface) {
    const text = surface.text;
    const id = ++this.previewId;
    surface.previewId = id;
    const images = Object.create(null);
    let remaining = 12 * 1024 * 1024;
    const found = new Set();
    for (const m of text.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^\n]+?)\)/g)) {
      if (found.size >= 12) break;
      if (found.has(m[0])) continue;
      found.add(m[0]);
      try {
        const link = decodeURIComponent((m[1] ?? m[2]).trim().replace(/^<|>$/g, ''));
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
        const file = this.app.metadataCache.getFirstLinkpathDest(link, surface.file.path);
        const mime = imageTypes[file?.extension?.toLowerCase()];
        if (!mime || !file.stat.size || file.stat.size > remaining) continue;
        const bytes = Buffer.from(await this.app.vault.readBinary(file));
        if (bytes.length > remaining) continue;
        remaining -= bytes.length;
        images[m[0]] = `data:${mime};base64,${bytes.toString('base64')}`;
      } catch (error) { console.warn('[floral-desk] Could not preview one local image.', error); }
    }
    if (surface.previewId === id && !surface.editing) this.updateNote(surface, { preview: { id, text, images } });
  }

  toggleFold(surface) {
    if (surface.role !== 'note' || !surface.pinned) return;
    const here = surface.win.getBounds();
    const work = this.remote.screen.getDisplayMatching(here).workArea;
    let next;
    if (surface.folded) {
      const { width, height } = surface.expanded;
      next = contain({ ...here, width, height }, work);
    } else {
      surface.expanded = here;
      next = contain({ ...here, width: Math.min(here.width, 234), height: foldHeight }, work);
    }
    surface.win.setBounds(next);
    surface.folded = !surface.folded;
    this.updateNote(surface);
    if (!surface.folded && !surface.editing) this.run(() => this.updatePreview(surface));
  }

  async pinFromClipboard() {
    const image = this.electron.clipboard.readImage();
    if (image.isEmpty()) { new Notice('剪贴板里没有图片。'); return; }
    await this.pinImage(image);
  }

  async pinImage(image) {
    if (this.pinOpening) return;
    const { width, height } = image.getSize();
    const pins = [...this.surfaces].filter((surface) => surface.role === 'image');
    const pixels = width * height;
    if (pins.length >= maxPins || pixels + pins.reduce((sum, pin) => sum + pin.pixels, 0) > maxPixels) {
      new Notice('贴图数量或总大小已达上限，请关闭一些贴图后重试。');
      return;
    }
    this.pinOpening = true;
    try {
      const { work } = this.workAtCursor();
      const surface = { role: 'image', png: image.toPNG(), ratio: width / height, pixels };
      await this.makeWindow(surface, fitImage(width, height, work, 0.78));
    } finally { this.pinOpening = false; }
  }

  zoom(surface, direction) {
    const bounds = surface.win.getBounds();
    const work = this.remote.screen.getDisplayMatching(bounds).workArea;
    const width = Math.max(Math.min(120, bounds.width), bounds.width * (direction > 0 ? 1.12 : 1 / 1.12));
    const size = fitImage(width, width / surface.ratio, work);
    surface.win.setBounds(contain({ ...bounds, ...size }, work));
  }

  async closeSurface(surface) {
    if (surface.closing || surface.win.isDestroyed()) return;
    surface.closing = true;
    try {
      if (surface.role !== 'image') await this.flush(surface);
      this.surfaces.delete(surface);
      surface.png = null;
      if (!surface.win.isDestroyed()) surface.win.destroy();
    } catch (error) { this.handleSaveError(surface, error); }
    finally { surface.closing = false; }
  }

  async handleAction(surface, action, value) {
    if (surface.win.isDestroyed()) return;
    if (action === 'close') { await this.closeSurface(surface); return; }
    if (surface.role === 'image') {
      if (action === 'ready') this.send(surface, { png: surface.png.toString('base64') });
      if (action === 'zoom' && (value === 1 || value === -1)) this.zoom(surface, value);
      if (action === 'drag-cancel') surface.dragAnchor = null;
      if ((action === 'drag-start' || action === 'drag' || action === 'drag-stop') && Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
        if (action === 'drag-start') {
          surface.dragAnchor = { point: value, bounds: surface.win.getBounds() };
        } else if (surface.dragAnchor) {
          const { point, bounds } = surface.dragAnchor;
          const work = this.remote.screen.getDisplayNearestPoint(value).workArea;
          const next = contain({ ...bounds, x: bounds.x + value.x - point.x, y: bounds.y + value.y - point.y }, work);
          surface.win.setPosition(next.x, next.y);
          if (action === 'drag-stop') surface.dragAnchor = null;
        }
      }
      if (action === 'copy') {
        this.electron.clipboard.writeImage(this.electron.nativeImage.createFromBuffer(surface.png));
        this.send(surface, { status: '已复制' });
      }
      if (action === 'save-png' && !surface.saving) {
        surface.saving = true;
        const png = surface.png;
        try {
          const result = await this.remote.dialog.showSaveDialog(surface.win, { title: '另存贴图', defaultPath: `截图-${noteStamp()}.png`, filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
          if (!result.canceled && result.filePath) await fsp.writeFile(result.filePath, png);
        } finally { surface.saving = false; }
      }
      return;
    }
    if (action === 'ready') {
      this.updateNote(surface, { text: surface.text, focus: surface.editing });
      if (!surface.editing) await this.updatePreview(surface);
    } else if (action === 'text' && surface.editing && typeof value === 'string') {
      surface.text = surface.savedText.includes('\r\n') ? value.replace(/\r?\n/g, '\r\n') : value;
      clearTimeout(surface.saveTimer);
      surface.saveTimer = setTimeout(() => void this.flush(surface).catch((error) => this.handleSaveError(surface, error)), 300);
    } else if (action === 'flush') {
      await this.flush(surface).catch((error) => this.handleSaveError(surface, error));
    } else if (action === 'alpha' && Number.isFinite(value)) {
      if (surface.role === 'quick') this.settings.quickAlpha = opacity(value);
      else this.settings.notes[surface.file.path] = { alpha: opacity(value) };
      this.saveSettingsSoon();
      this.updateNote(surface);
    } else if (action === 'default-alpha' && surface.role === 'note') {
      delete this.settings.notes[surface.file.path];
      this.saveSettingsSoon();
      this.updateNote(surface);
    } else if (action === 'pin' && surface.role === 'quick' && !surface.pinning) {
      if (!surface.text.trim() && !surface.file) { surface.status = '写下内容后再置顶。'; this.updateNote(surface); return; }
      surface.pinning = true;
      try {
        await this.flush(surface);
        await this.openNote(surface.file);
        await this.closeSurface(surface);
      } catch (error) { this.handleSaveError(surface, error); }
      finally { surface.pinning = false; }
    } else if (action === 'pin' && surface.role === 'note' && !surface.folded) {
      surface.pinned = !surface.pinned;
      surface.win.setAlwaysOnTop(surface.pinned);
      this.updateNote(surface);
    } else if (action === 'fold' || (action === 'expand' && surface.folded)) {
      this.toggleFold(surface);
    } else if (action === 'edit' && surface.role === 'note' && !surface.folded) {
      await this.flush(surface);
      surface.editing = !surface.editing;
      this.updateNote(surface, { text: surface.text, focus: surface.editing });
      if (!surface.editing) await this.updatePreview(surface);
    } else if (action === 'library' && surface.file) {
      await this.flush(surface);
      const main = this.remote.getCurrentWindow();
      if (main.isMinimized()) main.restore();
      main.show();
      await this.app.workspace.getLeaf(false).openFile(surface.file);
    }
  }

  writePendingNotes(surfaces) {
    if (!this.assetDir) return;
    const dirty = surfaces.filter((surface) => surface.text !== surface.savedText && (surface.text.trim() || surface.file));
    if (!dirty.length) return;
    const file = path.join(this.assetDir, `recovery-${Date.now()}-${process.pid}-${++this.recoveryId}.json`);
    try { fs.writeFileSync(file, JSON.stringify(dirty.map(({ text, file: note }) => ({ text, path: note?.path }))), { flag: 'wx' }); }
    catch (error) { this.report(error, '无法写入便签恢复副本。'); }
  }

  async restorePendingNotes() {
    const vault = this.app.vault;
    for (const name of await fsp.readdir(this.assetDir)) {
      if (!/^recovery-\d+-\d+(?:-\d+)?\.json$/.test(name)) continue;
      const recovery = path.join(this.assetDir, name);
      const drafts = JSON.parse(await fsp.readFile(recovery, 'utf8'));
      for (const draft of drafts) {
        const file = draft.path && vault.getAbstractFileByPath(draft.path);
        if (file instanceof TFile && await vault.read(file) === draft.text) continue;
        await this.createNote(draft.text, '便签恢复');
        new Notice('上次未完成保存的便签已另存到便签目录。');
      }
      await fsp.unlink(recovery);
    }
  }

  onunload() {
    this.stopped = true;
    if (!this.surfaces) return;
    this.writePendingNotes([...this.surfaces].filter((surface) => surface.role !== 'image'));
    for (const shortcut of this.shortcuts.values()) this.remote.globalShortcut.unregister(shortcut);
    this.shortcuts.clear();
    if (this.settingsTimer) this.persistSettings();
    for (const surface of this.surfaces) {
      clearTimeout(surface.saveTimer);
      if (!surface.win.isDestroyed()) surface.win.destroy();
    }
    this.surfaces.clear();
  }
};
