import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createDesktopHost } from '../../server/desktopHost';
import { setLogLevel } from '../../server/logger';

const smoke = DESKTOP_SMOKE_TEST;
let win;
let server;

async function start() {
  if (!smoke) {
    process.chdir(path.dirname(app.getPath('exe')));
    app.setAppUserModelId('com.alertcenter.desktop');
  }
  const secret = randomBytes(32).toString('base64url');
  // The window can edit this file from Settings. The smoke test gets its own, with sample data.
  const envFile = smoke ? path.join(app.getPath('userData'), 'smoke.env') : path.resolve('.env');
  const host = createDesktopHost({
    envFile,
    baseEnv: smoke ? {} : { ...process.env },
    distDir: path.join(app.getAppPath(), 'dist'),
    secret,
    openBrowser: url => shell.openExternal(url),
    onSignedIn: () => {
      if (win && !win.isDestroyed()) {
        win.loadURL(host.origin()).catch(() => {});
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    },
    ...(smoke ? { port: 0 } : {}),
  });
  setLogLevel(host.config().logLevel);

  server = createServer(host.handler).listen(host.port, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${host.port} is in use. Close the other local dashboard or change PORT in .env.`);
    throw new Error('Could not start the local dashboard.');
  }
  const port = server.address().port;
  host.listening(port);
  // The address follows the sign-in method, which Settings can change while the app runs.
  const origin = host.origin();
  const webSession = session.fromPartition(smoke ? 'desktop-smoke' : 'persist:alert-center-desktop');
  const inApp = raw => {
    try { return new URL(raw).origin === host.origin(); }
    catch { return false; }
  };
  webSession.webRequest.onBeforeSendHeaders({ urls: [`http://localhost:${port}/*`, `http://127.0.0.1:${port}/*`] }, (details, done) => {
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
        const status = response.ok ? await response.json() : {};
        if (status.mode !== 'demo' || status.configEditor !== true) return false;
        for (let attempt = 0; attempt < 50; attempt++) {
          if (document.querySelector('nav[aria-label="Main"]')) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!document.querySelector('nav[aria-label="Main"]') || typeof require !== 'undefined') return false;
        // The window reads the configuration, never a secret, and saves one harmless setting.
        const read = await fetch('/api/desktop/config').then(r => r.json());
        if (!read.fields?.length || read.fields.some(field => /SECRET|TOKEN/.test(field.key) && field.value !== null)) return false;
        const saved = await fetch('/api/desktop/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Alert-Center-Action': '1' },
          body: JSON.stringify({ values: { CUSTOMER_PROPERTY_KEYS: 'customer, customers, tenant' } }),
        });
        return saved.ok && (await saved.json()).mode === 'demo';
      })
    `);
    const written = result && readFileSync(envFile, 'utf8').includes('CUSTOMER_PROPERTY_KEYS=customer, customers, tenant');
    await win.loadURL(`${origin}/setup`);
    const setup = await win.webContents.executeJavaScript(`
      (async () => {
        for (let attempt = 0; attempt < 50; attempt++) {
          const form = document.querySelector('form[aria-label="Configuration file"]');
          if (form) return form.querySelector('input[name="CUSTOMER_PROPERTY_KEYS"]')?.value === 'customer, customers, tenant';
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
      })()
    `);
    const outside = await Promise.all(['/api/status', '/api/desktop/config', '/setup'].map(route => fetch(`${origin}${route}`)));
    if (!result || !written || !setup || outside.some(response => response.status !== 403)) throw new Error('Desktop window smoke check failed.');
    console.log('Desktop window rendered demo and saved a setting, with Node disabled in the UI and the browser denied.');
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
