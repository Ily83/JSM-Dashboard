// Cross-build from a clean staging directory. No working .env or customer files are copied.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { build as bundle } from 'esbuild';
import { build as buildUI } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const runtime = 'node-v22.23.5-win-x64';
// From https://nodejs.org/dist/v22.23.5/SHASUMS256.txt
const runtimeHash = '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const zipName = `Alert-Center-${version}-windows-x64.zip`;
const staging = await mkdtemp(path.join(os.tmpdir(), 'alert-center-'));
try {
  const binary = path.join(staging, 'Alert Center.exe');
  execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', binary, 'scripts/windows/launcher.go'], {
    env: { ...process.env, CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64' }, stdio: 'inherit',
  });
  await buildUI({ build: { outDir: path.join(staging, 'dist'), emptyOutDir: true, copyPublicDir: false } });
  for (const file of ['theme-init.js', 'favicon.svg']) await copyFile(`public/${file}`, path.join(staging, 'dist', file));
  await bundle({ entryPoints: ['server/index.ts'], outfile: path.join(staging, 'server.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
  for (const file of ['.env.example', 'README.md']) await copyFile(file, path.join(staging, file));
  await copyFile('scripts/windows/START-HERE.txt', path.join(staging, 'START-HERE.txt'));

  const download = await fetch(`https://nodejs.org/dist/v22.23.5/${runtime}.zip`, { signal: AbortSignal.timeout(120_000) });
  if (!download.ok) throw new Error(`Node runtime download failed: ${download.status}`);
  const data = Buffer.from(await download.arrayBuffer());
  if (sha256(data) !== runtimeHash) throw new Error('Node runtime checksum mismatch.');
  const node = new AdmZip(data);
  await mkdir(path.join(staging, 'runtime'));
  for (const name of ['node.exe', 'LICENSE']) {
    const contents = node.readFile(`${runtime}/${name}`);
    if (!contents) throw new Error(`Missing ${name} in the Node distribution.`);
    await writeFile(path.join(staging, 'runtime', name), contents);
  }

  const licenses = path.join(staging, 'licenses');
  await mkdir(licenses);
  await copyFile('scripts/windows/Go-LICENSE.txt', path.join(licenses, 'Go.txt'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  for (const [dir, pkg] of Object.entries(lock.packages)) {
    if (!dir || pkg.dev) continue;
    for (const file of await readdir(dir)) {
      if (/^(licen[cs]e|copying|notice)(\..*)?$/i.test(file)) {
        await copyFile(path.join(dir, file), path.join(licenses, `${dir.slice(13).replaceAll('/', '_')}-${file}`));
      }
    }
  }

  const zip = new AdmZip();
  zip.addLocalFolder(staging);
  const output = path.join(root, 'release', zipName);
  await mkdir(path.dirname(output), { recursive: true });
  const archive = zip.toBuffer();
  await writeFile(output, archive);
  await writeFile(`${output}.sha256`, `${sha256(archive)}  ${zipName}\n`);
  console.log(`Built ${output} (${(archive.length / 1024 ** 2).toFixed(1)} MiB)`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
