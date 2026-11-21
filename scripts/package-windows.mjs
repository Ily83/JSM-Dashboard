// Reproduce the desktop ZIP without copying .env or customer files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { build as bundle } from 'esbuild';
import { build as buildUI } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const linuxSmoke = process.argv.includes('--linux-smoke');
const electron = '45.4.1';
const platform = linuxSmoke ? 'linux' : 'win32';
// https://github.com/electron/electron/releases/download/v45.4.1/SHASUMS256.txt
const hash = linuxSmoke ? 'e1d077c7a087d7e344350ea0c5cd2b7dc5af3d9bf7979474f38e0fc1a560b875' : '2ba6223afa9121f42831fefe92c434334907540165294fc56697449d12e7cfe9';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const requireSigning = process.argv.includes('--require-signing');
const cert = process.env.WINDOWS_SIGN_CERT_SHA1;
if (requireSigning && !cert) throw new Error('Set WINDOWS_SIGN_CERT_SHA1 to an approved code-signing certificate thumbprint.');
if (cert && !linuxSmoke && (process.platform !== 'win32' || !/^[a-f0-9]{40}$/i.test(cert))) {
  throw new Error('Signing requires a Windows build machine and a valid certificate thumbprint.');
}
const staging = await mkdtemp(path.join(os.tmpdir(), 'alert-center-'));
try {
  const url = `https://github.com/electron/electron/releases/download/v${electron}/electron-v${electron}-${platform}-x64.zip`;
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Electron runtime download failed (${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== hash) throw new Error('Electron runtime checksum mismatch.');
  new AdmZip(data).extractAllTo(staging, true, true);
  await rm(path.join(staging, 'resources', 'default_app.asar'), { force: true });
  const executable = path.join(staging, linuxSmoke ? 'electron' : 'Alert Center.exe');
  if (!linuxSmoke) await rename(path.join(staging, 'electron.exe'), executable);
  else await chmod(executable, 0o755);

  const appDir = path.join(staging, 'resources', 'app');
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'alert-center', productName: 'Alert Center', version, main: 'main.cjs' }));
  await bundle({
    entryPoints: ['scripts/windows/desktop.mjs'], outfile: path.join(appDir, 'main.cjs'), bundle: true,
    platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], define: { DESKTOP_SMOKE_TEST: String(linuxSmoke) },
  });
  const dist = path.join(appDir, 'dist');
  await buildUI({ build: { outDir: dist, emptyOutDir: true, copyPublicDir: false } });
  for (const file of ['theme-init.js', 'favicon.svg']) await copyFile(`public/${file}`, path.join(dist, file));
  if (linuxSmoke) {
    // CI-only fallback for hosts without a Chromium sandbox. The smoke bundle
    // serves generated demo data only, and never ships in the Windows ZIP.
    const flags = process.argv.includes('--ci-no-sandbox') ? ['--no-sandbox'] : [];
    execFileSync(executable, flags, {
      stdio: 'inherit', timeout: 45_000, env: { ...process.env, XDG_CONFIG_HOME: path.join(staging, 'smoke-profile') },
    });
  } else {
    for (const file of ['.env.example', 'README.md']) await copyFile(file, path.join(staging, file));
    await copyFile('scripts/windows/START-HERE.txt', path.join(staging, 'START-HERE.txt'));
    const licenses = path.join(staging, 'licenses');
    await mkdir(licenses);
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
    for (const [dir, pkg] of Object.entries(lock.packages)) {
      if (!dir || pkg.dev) continue;
      for (const file of await readdir(dir)) {
        if (/^(licen[cs]e|copying|notice)(\..*)?$/i.test(file)) {
          await copyFile(path.join(dir, file), path.join(licenses, `${dir.slice(13).replaceAll('/', '_')}-${file}`));
        }
      }
    }
    if (cert) {
      const signtool = process.env.SIGNTOOL_EXE ?? 'signtool.exe';
      const timestamp = process.env.WINDOWS_SIGN_TIMESTAMP;
      if (!timestamp?.startsWith('https://')) throw new Error('Set WINDOWS_SIGN_TIMESTAMP to the approved RFC 3161 HTTPS timestamp service.');
      const store = process.env.WINDOWS_SIGN_MACHINE_STORE === '1' ? ['/sm'] : [];
      execFileSync(signtool, ['sign', ...store, '/sha1', cert, '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256', executable], { stdio: 'inherit' });
      execFileSync(signtool, ['verify', '/pa', '/tw', executable], { stdio: 'inherit' });
    }
    const zip = new AdmZip();
    zip.addLocalFolder(staging);
    const base = `Alert-Center-${version}-desktop-windows-x64${cert ? '' : '-unsigned'}.zip`;
    const output = path.join(root, 'release', base);
    await mkdir(path.dirname(output), { recursive: true });
    const archive = zip.toBuffer();
    await writeFile(output, archive);
    await writeFile(`${output}.sha256`, `${sha256(archive)}  ${base}\n`);
    console.log(`Built ${output} (${(archive.length / 1024 ** 2).toFixed(1)} MiB)`);
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
