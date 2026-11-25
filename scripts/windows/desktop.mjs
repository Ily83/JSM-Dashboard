import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { loadConfig } from '../../server/config';
import { createDashboard } from '../../server/runtime';
import { setLogLevel } from '../../server/logger';

const smoke = DESKTOP_SMOKE_TEST;
let win;
let server;

async function start() {
  if (!smoke) {
    process.chdir(path.dirname(app.getPath('exe')));
    app.setAppUserModelId('com.alertcenter.desktop');
  }
  const config = smoke ? loadConfig({ DEMO_MODE: 'true' }) : loadConfig();
  config.host = '127.0.0.1';
  config.isProduction = true;
  config.distDir = path.join(app.getAppPath(), 'dist');
  config.allowedHosts = [];
  setLogLevel(config.logLevel);

  const callback = config.oauth && new URL(config.oauth.redirectUri);
  if (callback && Number(callback.port || 80) !== config.port) {
    throw new Error('The OAuth callback must use the same PORT as the desktop app.');
  }
  const secret = randomBytes(32).toString('base64url');
  let origin;
  const dash = createDashboard(config, {
    isWindow: req => req.get('x-alert-center-desktop') === secret && req.get('host') === new URL(origin).host,
    openBrowser: url => shell.openExternal(url),
    onSignedIn: () => {
      if (win && !win.isDestroyed()) {
        win.loadURL(origin).catch(() => {});
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    },
  });
  server = dash.listen(smoke ? 0 : config.port, config.host);
  try { await once(server, 'listening'); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${config.port} is in use. Close the other local dashboard or change PORT in .env.`);
    throw new Error('Could not start the local dashboard.');
  }
  origin = callback?.origin ?? `http://127.0.0.1:${server.address().port}`;
  const webSession = session.fromPartition(smoke ? 'desktop-smoke' : 'persist:alert-center-desktop');
  const inApp = raw => {
    try { return new URL(raw).origin === origin; }
    catch { return false; }
  };
  webSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, done) => {
    const requestHeaders = details.requestHeaders;
    if (inApp(details.url)) requestHeaders['X-Alert-Center-Desktop'] = secret;
    done({ requestHeaders });
  });
  webSession.setPermissionRequestHandler((contents, permission, answer) => {
    answer(contents === win?.webContents && inApp(contents.getURL()) && permission === 'notifications');
  });
  webSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    contents === win?.webContents && inApp(requestingOrigin) && permission === 'notifications');
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 380, minHeight: 340, show: false, autoHideMenuBar: true,
    title: 'Jira Operations – Alert Center',
    webPreferences: { session: webSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  win.removeMenu();
  const external = raw => {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && !url.username && !url.password) shell.openExternal(url.href).catch(() => {});
    } catch { /* no external navigation */ }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!inApp(url)) external(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!inApp(url)) { event.preventDefault(); external(url); }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!inApp(url)) event.preventDefault();
  });
  if (!smoke) win.once('ready-to-show', () => win.show());
  await win.loadURL(origin);
  if (smoke) {
    const result = await win.webContents.executeJavaScript(`
      fetch('/api/status').then(async response => {
        if (!response.ok || (await response.json()).mode !== 'demo') return false;
        for (let attempt = 0; attempt < 50; attempt++) {
          if (document.querySelector('nav[aria-label="Main"]')) return typeof require === 'undefined';
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
      })
    `);
    const outside = await fetch(`${origin}/api/status`);
    if (!result || outside.status !== 403) throw new Error('Desktop window smoke check failed.');
    console.log('Desktop window rendered demo, with Node disabled in the UI and the browser denied.');
    app.quit();
  }
}

if (!app.requestSingleInstanceLock() && !smoke) app.quit();
else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { server?.close(); server?.closeAllConnections(); });
  app.whenReady().then(start).catch(error => {
    const message = error instanceof Error ? error.message : 'Could not start Alert Center.';
    if (smoke) console.error(message);
    else dialog.showErrorBox('Alert Center could not start', message);
    app.exit(1);
  });
}
