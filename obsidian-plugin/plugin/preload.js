"use strict";

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floral', {
  send(action, value) {
    ipcRenderer.send('floral-desk:action', action, value);
  },
  receive(callback) {
    ipcRenderer.on('floral-desk:state', (_event, state) => callback(state));
  },
});
