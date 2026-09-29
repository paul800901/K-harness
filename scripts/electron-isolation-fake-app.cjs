// Fake-data-only Electron main process used by electron-isolation-probe.mjs.
const {app, BrowserWindow} = require('electron');

let windowRef;
app.whenReady().then(async () => {
  windowRef = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false},
  });
  await windowRef.loadURL('data:text/html,<title>K%20FAKE%20ISOLATION</title><p>FAKE_ONLY_ELECTRON_ISOLATION</p>');
  if (process.send) process.send({type: 'ready', pid: process.pid, fakeOnly: true});
});

process.on('message', message => {
  if (message?.type === 'stop-fake-only') app.quit();
});

app.on('window-all-closed', () => app.quit());
