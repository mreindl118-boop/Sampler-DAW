const { app, BrowserWindow, dialog, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_URL, MIDI_PERMISSIONS, isBundleURL, resolveBundlePath, isTrustedRequest } = require('./policy.cjs');

app.setName('SoundLAB Studio');
protocol.registerSchemesAsPrivileged([{ scheme: 'soundlab', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true,
} }]);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; " +
  "worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
  "form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
let window = null;
let microphoneAllowed = false;

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

function createWindow() {
  window = new BrowserWindow({
    title: 'SoundLAB Studio', width: 1440, height: 960, minWidth: 800, minHeight: 600,
    backgroundColor: '#10131b', show: false, icon: path.join(__dirname, 'icons/icon.png'),
    webPreferences: {
      session: session.fromPartition('persist:soundlab'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false,
      autoplayPolicy: 'document-user-activation-required',
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    // Links open outside the privileged renderer; never accept file/custom shell URLs.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!isBundleURL(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!isBundleURL(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('page-title-updated', event => { event.preventDefault(); window?.setTitle('SoundLAB Studio'); });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  void window.loadURL(APP_URL);
}

if (hasInstanceLock) app.whenReady().then(() => {
  const bundledRoot = path.join(app.getAppPath(), 'dist');
  const appSession = session.fromPartition('persist:soundlab');
  appSession.protocol.handle('soundlab', async request => {
    const target = resolveBundlePath(bundledRoot, request.url);
    if (!target || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  appSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    const trusted = isTrustedRequest(contents, window?.webContents, details.requestingUrl || origin, details.isMainFrame);
    if (!trusted) return false;
    if (MIDI_PERMISSIONS.has(permission)) return true;
    return permission === 'media' && details.mediaType === 'audio' && microphoneAllowed;
  });
  appSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (!isTrustedRequest(contents, window?.webContents, details.requestingUrl, details.isMainFrame)) return callback(false);
    if (MIDI_PERMISSIONS.has(permission)) return callback(true);
    if (permission !== 'media' || !details.mediaTypes?.length || details.mediaTypes.some(type => type !== 'audio')) return callback(false);
    if (!microphoneAllowed) {
      try {
        const result = await dialog.showMessageBox(window, {
          type: 'question', title: 'SoundLAB Studio — microphone',
          message: 'Allow SoundLAB Studio to record from your microphone or audio interface?',
          buttons: ['Allow', 'Deny'], defaultId: 1, cancelId: 1,
        });
        microphoneAllowed = result.response === 0;
      } catch { microphoneAllowed = false; }
    }
    callback(microphoneAllowed);
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  dialog.showErrorBox('SoundLAB Studio could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
