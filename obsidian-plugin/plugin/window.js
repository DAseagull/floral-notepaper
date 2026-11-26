"use strict";

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const preview = $('preview');
const send = window.floral.send;
let mode;
let lastPreview;
let composing = false;
let wheelTime = 0;
let dragTime = 0;
let dragPointer = null;

function showAlpha(value) {
  document.documentElement.style.setProperty('--paper', `rgb(255 248 218 / ${1 - value / 100})`);
  document.body.classList.toggle('clear-paper', value >= 75);
  $('alpha').value = String(value);
  $('percent').textContent = `${value}%`;
}

function addInline(parent, line, images) {
  const pattern = /(!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^\n]+?\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  let index = 0;
  for (const match of line.matchAll(pattern)) {
    parent.append(line.slice(index, match.index));
    const token = match[0];
    if (token.startsWith('!') && Object.hasOwn(images, token)) {
      const img = document.createElement('img');
      img.src = images[token];
      img.alt = '便签图片';
      parent.append(img);
    } else if (token.startsWith('**') || token.startsWith('`')) {
      const element = document.createElement(token.startsWith('**') ? 'strong' : 'code');
      element.textContent = token.startsWith('**') ? token.slice(2, -2) : token.slice(1, -1);
      parent.append(element);
    } else {
      parent.append(token);
    }
    index = match.index + token.length;
  }
  parent.append(line.slice(index));
}

function renderPreview(text, images) {
  const fragment = document.createDocumentFragment();
  for (const line of text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/)) {
    const row = document.createElement('div');
    const heading = /^#{1,6} +(.*)$/.exec(line);
    if (heading) row.className = 'heading';
    addInline(row, heading?.[1] ?? line, images);
    fragment.append(row);
  }
  preview.replaceChildren(fragment);
}

function updateState(state) {
  mode = state.role;
  if (state.role === 'image') {
    document.title = '花笺贴图';
    document.body.classList.add('image-window');
    $('toolbar').hidden = true;
    $('image-surface').hidden = false;
    if (state.png) $('image').src = `data:image/png;base64,${state.png}`;
    if (state.status) $('copy').textContent = state.status;
    return;
  }
  const folded = Boolean(state.folded);
  document.title = `花笺 · ${state.title}`;
  document.body.classList.toggle('folded', folded);
  $('title').textContent = state.title;
  $('title').tabIndex = folded ? 0 : -1;
  $('edit').hidden = folded || state.role === 'quick';
  $('edit').textContent = state.editing ? '预览' : '编辑';
  $('library').hidden = folded || state.role === 'quick';
  $('pin').hidden = folded;
  $('pin').textContent = state.role === 'note' && state.pinned ? '取消置顶' : '置顶';
  $('appearance').hidden = folded;
  $('fold').hidden = state.role !== 'note' || (!state.pinned && !folded);
  $('fold').textContent = folded ? '⌄' : '⌃';
  $('fold').setAttribute('aria-label', folded ? '展开便签' : '折叠便签');
  $('fold').title = folded ? '展开便签' : '折叠便签';
  if (folded) $('alpha-panel').hidden = true;
  $('reset-alpha').hidden = state.role !== 'note';
  $('status').hidden = folded || !state.status;
  $('status').textContent = state.status ?? '';
  showAlpha(state.alpha);
  editor.hidden = folded || !state.editing;
  preview.hidden = folded || state.editing;
  if (typeof state.text === 'string' && editor.value !== state.text.replace(/\r\n/g, '\n')) {
    editor.value = state.text;
  }
  if (!preview.hidden && state.preview && lastPreview !== state.preview.id) {
    lastPreview = state.preview.id;
    renderPreview(state.preview.text, state.preview.images);
  }
  if (state.focus && !editor.hidden) editor.focus();
}

const buttons = {
  edit: 'edit', library: 'library', pin: 'pin', fold: 'fold', title: 'expand',
  close: 'close', 'close-image': 'close', copy: 'copy', save: 'save-png',
  'reset-alpha': 'default-alpha',
};
for (const [id, action] of Object.entries(buttons)) {
  $(id).addEventListener('click', () => send(action));
}
$('smaller').addEventListener('click', () => send('zoom', -1));
$('larger').addEventListener('click', () => send('zoom', 1));
$('appearance').addEventListener('click', () => {
  const panel = $('alpha-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) $('alpha').focus();
});
$('alpha').addEventListener('input', (event) => showAlpha(Number(event.target.value)));
$('alpha').addEventListener('change', (event) => send('alpha', Number(event.target.value)));
editor.addEventListener('compositionstart', () => { composing = true; });
editor.addEventListener('compositionend', () => {
  composing = false;
  send('text', editor.value);
});
editor.addEventListener('input', () => {
  if (!composing) send('text', editor.value);
});
preview.addEventListener('dblclick', () => send('edit'));
document.addEventListener('keydown', (event) => {
  if (composing || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') {
    if ($('alpha-panel').hidden) send('close');
    else $('alpha-panel').hidden = true;
  } else if (event.ctrlKey && mode === 'image' && (key === 'c' || key === 's')) {
    event.preventDefault();
    send(key === 'c' ? 'copy' : 'save-png');
  } else if (event.ctrlKey && key === 's') {
    event.preventDefault();
    send('flush');
  }
});
$('image-surface').addEventListener('wheel', (event) => {
  event.preventDefault();
  if (!event.deltaY || performance.now() - wheelTime < 45) return;
  wheelTime = performance.now();
  send('zoom', event.deltaY < 0 ? 1 : -1);
}, { passive: false });
const image = $('image');
const dragPoint = (event) => ({ x: Math.round(event.screenX), y: Math.round(event.screenY) });
image.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  image.setPointerCapture(event.pointerId);
  dragPointer = event.pointerId;
  send('drag-start', dragPoint(event));
});
image.addEventListener('pointermove', (event) => {
  if (event.pointerId !== dragPointer || performance.now() - dragTime < 32) return;
  dragTime = performance.now();
  send('drag', dragPoint(event));
});
image.addEventListener('pointerup', (event) => {
  if (event.pointerId !== dragPointer) return;
  dragPointer = null;
  send('drag-stop', dragPoint(event));
});
image.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId !== dragPointer) return;
  dragPointer = null;
  send('drag-cancel');
});

window.floral.receive(updateState);
send('ready');
