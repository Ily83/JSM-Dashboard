// On Windows this starts the actual launcher; elsewhere it exercises the extracted backend with local Node.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zip = new AdmZip(path.join(root, 'release', `Alert-Center-${version}-windows-x64.zip`));
const entries = zip.getEntries().map(e => e.entryName);
assert.ok(entries.includes('.env.example') && !entries.some(name => /(^|\/)\.env($|\.(?!example$))/.test(name)));
for (const file of ['Alert Center.exe', 'runtime/node.exe']) {
  const bytes = zip.readFile(file);
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ', file);
  assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4), 0x8664, `${file}: expected Windows x64`);
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'Alert Center smoke '));
try {
  zip.extractAllTo(dir);
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  for (const oauth of [false, true]) {
    // Never inherit a developer's Jira configuration; the OAuth pass stops before external authorization.
    await writeFile(path.join(dir, '.env'), oauth ? [
      'JIRA_AUTH_MODE=oauth', 'JIRA_SITE_URL=https://example.atlassian.net', 'JIRA_OAUTH_CLIENT_ID=test',
      'JIRA_OAUTH_CLIENT_SECRET=test', `JIRA_OAUTH_REDIRECT_URI=${origin}/api/auth/callback`,
    ].join('\n') : 'DEMO_MODE=true');
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'info', JSM_NO_BROWSER: '1' };
    for (const key of Object.keys(env)) if (/^(JIRA_|DEMO_|CUSTOMER_|NODE_OPTIONS$)/i.test(key)) delete env[key];
    const win = process.platform === 'win32';
    const child = win
      ? spawn(path.join(dir, 'Alert Center.exe'), [], { cwd: os.tmpdir(), env, windowsHide: true })
      : spawn(process.execPath, ['server.cjs', '--production', '--portable'], { cwd: dir, env });
    child.stdin.end();
    const exit = once(child, 'exit');
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 15_000);
        child.stdout.on('data', chunk => {
          output += chunk;
          if (output.includes('alert center backend listening')) { clearTimeout(timer); resolve(); }
        });
        child.stderr.on('data', chunk => { output += chunk; });
        exit.then(() => { clearTimeout(timer); reject(new Error(output)); }, reject);
      });
      const status = await fetch(`${origin}/api/status`);
      if (oauth) {
        assert.equal(status.status, 401);
        const start = await fetch(`${origin}/api/auth/start`, { redirect: 'manual' });
        const target = new URL(start.headers.get('location'));
        assert.equal(target.origin, 'https://auth.atlassian.com');
        assert.equal(target.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
      } else {
        assert.equal((await status.json()).mode, 'demo');
        const html = await (await fetch(origin)).text();
        assert.match(html, /Jira Operations/);
        for (const asset of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
          assert.equal((await fetch(origin + asset[1])).status, 200, asset[1]);
        }
        assert.equal((await fetch(`${origin}/api/alerts`)).status, 200);
      }
    } finally {
      if (child.exitCode === null && child.pid) {
        if (win) execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        else child.kill();
      }
      await exit;
    }
  }
  console.log(`Portable ZIP passed demo and signed-out OAuth checks (${process.platform === 'win32' ? 'Windows launcher' : 'host Node runtime'}).`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
