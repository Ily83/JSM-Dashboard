import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_IDS, type ActionId } from '../shared/actions';
import type { MaintenancesResponse } from '../shared/opsContext';
import type { AlertDetail, ExtractionRules } from '../shared/types';
import { createApp } from '../server/app';
import { loadConfig, type AppConfig, type JiraConfig } from '../server/config';
import { buildCustomerMap, CustomerMapError, loadCustomerMap, parseCustomerMapCsv, parseCustomerMapJson } from '../server/customerMap';
import { DemoOpsContext } from '../server/demo/demoOpsContext';
import { DemoSource } from '../server/demo/demoSource';
import { JiraClient } from '../server/jira/client';
import { mapAlert } from '../server/jira/mapper';
import { coverageOf, flattenOnCall, JiraOpsContext, mapMaintenance } from '../server/jira/opsContext';
import { AlertStore } from '../server/services/alertStore';
import { ActionRequestError, ActionService } from '../server/services/operations';
import { MaintenanceService, parseNewMaintenance } from '../server/services/opsContext';
import type { AlertSource } from '../server/services/source';

const NOW = Date.parse('2026-11-19T12:00:00Z');

// ---- Jira client against a fake API --------------------------------------------

const jiraConfig = {
  siteUrl: 'https://example.atlassian.net',
  siteHost: 'example.atlassian.net',
  cloudId: 'cloud-123',
  email: 'ops@example.com',
  apiToken: 'ATATT-example-not-a-real-token',
  requestTimeoutMs: 5000,
} as JiraConfig;

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

function fakeApi(script: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/jsm/ops/api/cloud-123', ''),
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return script(call);
  }) as typeof fetch;
  return { client: new JiraClient(jiraConfig, 4, fetchImpl), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const rawMaintenance = {
  id: 'm1',
  status: 'active',
  description: 'Proxy upgrade',
  startDate: '2026-11-19T11:00:00Z',
  endDate: '2026-11-19T13:00:00Z',
  rules: [
    { entity: { id: 'int-1', type: 'integration' }, state: 'disabled' },
    { entity: { id: 'pol-1', type: 'policy' }, state: 'enabled' },
  ],
};

describe('JiraClient: operations context (against a fake API)', () => {
  it('reads maintenances, entities, schedules, heartbeats and on-call from the documented paths', async () => {
    const { client, calls } = fakeApi((call) => {
      if (call.path.endsWith('/on-calls')) return json({ onCallParticipants: [{ id: 't1', type: 'team', onCallParticipants: [{ id: 'u1', type: 'user' }] }] });
      return json({ values: call.path.includes('maintenances') ? [rawMaintenance] : [{ id: 'x1', name: 'X', status: 'Responsive' }], links: {} });
    });
    expect(await client.listMaintenances()).toHaveLength(1);
    await client.listMaintenances('team 1');
    await client.listMaintenanceEntities('integration');
    await client.listMaintenanceEntities('policy');
    await client.listMaintenanceEntities('sync');
    await client.listScheduleDetails();
    expect(await client.listHeartbeats('t1')).toEqual([expect.objectContaining({ name: 'X', status: 'Responsive' })]);
    const tree = await client.listOnCall('s1');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/maintenances',
      'GET /v1/teams/team%201/maintenances',
      'GET /v1/integrations',
      'GET /v1/alerts/policies',
      'GET /v1/syncs',
      'GET /v1/schedules',
      'GET /v1/teams/t1/heartbeats',
      'GET /v1/schedules/s1/on-calls',
    ]);
    expect(calls[0]!.query.get('type')).toBe('non-expired');
    expect(calls[5]!.query.get('size')).toBe('50');
    expect(calls[7]!.query.get('flat')).toBe('false');
    expect(flattenOnCall(tree, (type) => (type === 'team' ? 'Cloud Operations' : null))).toEqual([
      { id: 't1', type: 'team', name: 'Cloud Operations' },
      { id: 'u1', type: 'user', name: null },
    ]);
  });

  it('follows pages until links.next is missing', async () => {
    const { client, calls } = fakeApi((call) =>
      json({ values: [{ id: `i${call.query.get('offset')}`, name: 'n' }], links: call.query.get('offset') === '0' ? { next: '/v1/integrations?offset=100' } : {} }),
    );
    expect(await client.listMaintenanceEntities('integration')).toHaveLength(2);
    expect(calls.map((c) => c.query.get('offset'))).toEqual(['0', '100']);
  });

  it('creates and cancels global and team maintenances with the documented bodies', async () => {
    const { client, calls } = fakeApi((call) => json({ ...rawMaintenance, status: call.path.endsWith('/cancel') ? 'cancelled' : 'active' }, call.path.endsWith('/cancel') ? 200 : 201));
    const body = { description: 'Patching', startDate: '2026-11-19T12:00:00.000Z', endDate: '2026-11-19T13:00:00.000Z', rules: [{ entity: { id: 'int-1', type: 'integration' as const }, state: 'disabled' as const }] };
    await client.createMaintenance(body, null);
    await client.createMaintenance(body, 't1');
    expect((await client.cancelMaintenance('m1', null)).status).toBe('cancelled');
    await client.cancelMaintenance('m1', 't1');
    expect(calls.map((c) => ({ method: c.method, path: c.path, body: c.body }))).toEqual([
      { method: 'POST', path: '/v1/maintenances', body },
      { method: 'POST', path: '/v1/teams/t1/maintenances', body },
      { method: 'POST', path: '/v1/maintenances/m1/cancel', body: undefined },
      { method: 'POST', path: '/v1/teams/t1/maintenances/m1/cancel', body: undefined },
    ]);
  });

  it("passes Jira's own reason for a refused write, but never repeats it after a 5xx", async () => {
    const refused = fakeApi(() => json({ message: 'You are not allowed to manage maintenances.' }, 403));
    await expect(refused.client.cancelMaintenance('m1', null)).rejects.toThrow('Jira refused the request (403): You are not allowed to manage maintenances.');
    const failing = fakeApi(() => json({ message: 'internal' }, 500));
    await expect(failing.client.cancelMaintenance('m1', null)).rejects.toThrow(/failed to process/);
    expect(failing.calls).toHaveLength(1);
  });
});

describe('maintenance mapping and coverage', () => {
  it('names rules, keeps the team and marks integrations of active windows as covered', () => {
    const m = mapMaintenance(rawMaintenance, 't1', new Map([['t1', 'Network']]), new Map([['integration:int-1', 'Zabbix'], ['policy:pol-1', 'Route']]));
    expect(m).toMatchObject({ id: 'm1', teamId: 't1', teamName: 'Network', status: 'active', startDate: Date.parse(rawMaintenance.startDate) });
    expect(m.rules.map((r) => [r.name, r.state])).toEqual([
      ['Zabbix', 'disabled'],
      ['Route', 'enabled'],
    ]);
    expect(coverageOf([m])).toEqual([{ integrationName: 'Zabbix', maintenanceId: 'm1' }]);
    expect(coverageOf([{ ...m, status: 'planned' }])).toEqual([]);
  });

  it('JiraOpsContext lists global and team windows and caches them', async () => {
    const { client, calls } = fakeApi((call) => {
      if (call.path === '/v1/maintenances') return json({ values: [rawMaintenance], links: {} });
      if (call.path === '/v1/teams/t1/maintenances') return json({ values: [{ ...rawMaintenance, id: 'm2', status: 'planned', rules: [] }], links: {} });
      if (call.path === '/v1/integrations') return json({ values: [{ id: 'int-1', name: 'Zabbix' }], links: {} });
      if (call.path === '/v1/alerts/policies') return json({ values: [{ id: 'pol-1', name: 'Route' }], links: {} });
      return json({}, 404);
    });
    const ops = new JiraOpsContext(client, async () => [{ id: 't1', name: 'Network' }], async () => []);
    const first = await ops.maintenances();
    expect(first.maintenances.map((m) => [m.id, m.status, m.teamName])).toEqual([
      ['m1', 'active', null],
      ['m2', 'planned', 'Network'],
    ]);
    expect(first.coverage).toEqual([{ integrationName: 'Zabbix', maintenanceId: 'm1' }]);
    const sent = calls.length;
    await ops.maintenances();
    expect(calls.length).toBe(sent);
  });
});

describe('parseNewMaintenance', () => {
  const valid = {
    description: '  Patching  ',
    startDate: new Date(NOW).toISOString(),
    endDate: new Date(NOW + 3_600_000).toISOString(),
    teamId: null,
    rules: [
      { entity: { id: 'int-1', type: 'integration' }, state: 'disabled' },
      { entity: { id: 'int-1', type: 'integration' }, state: 'disabled' },
      { entity: { id: 'pol-1', type: 'policy' }, state: 'enabled' },
    ],
  };

  it('accepts a valid window, trims and removes duplicate rules', () => {
    const parsed = parseNewMaintenance(valid, NOW);
    expect(parsed.description).toBe('Patching');
    expect(parsed.rules).toHaveLength(2);
  });

  it('refuses bad windows and rules, naming fields but not values', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ ...valid, description: '' }, /description/],
      [{ ...valid, rules: [] }, /rules/],
      [{ ...valid, startDate: new Date(NOW - 3_600_000).toISOString() }, /past/],
      [{ ...valid, endDate: valid.startDate }, /after the start/],
      [{ ...valid, endDate: new Date(NOW + 15 * 86_400_000).toISOString() }, /14 days/],
      [{ ...valid, rules: [{ entity: { id: 'int-1', type: 'integration' }, state: 'enabled' }] }, /only be disabled/],
      [{ ...valid, rules: [{ entity: { id: 'secret value', type: 'integration' }, state: 'disabled' }] }, /rules/],
    ];
    for (const [body, message] of cases) {
      let error: unknown;
      try {
        parseNewMaintenance(body, NOW);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ActionRequestError);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain('secret');
    }
  });
});

// ---- Customer mapping file --------------------------------------------------------

describe('CUSTOMER_MAP_FILE', () => {
  it('reads CSV with a header, comments, quotes and several customers', () => {
    const rules = parseCustomerMapCsv('﻿entity,customers\n# comment\n\nvm-contoso-*,Contoso\ner-ams-01,"Contoso; Fabrikam"\nsql?-fin,Woodgrove Bank|Litware\nextra,A,B\n');
    expect(rules).toEqual([
      { pattern: 'vm-contoso-*', customers: ['Contoso'] },
      { pattern: 'er-ams-01', customers: ['Contoso', 'Fabrikam'] },
      { pattern: 'sql?-fin', customers: ['Woodgrove Bank', 'Litware'] },
      { pattern: 'extra', customers: ['A', 'B'] },
    ]);
  });

  it('reads JSON as an object or a list', () => {
    expect(parseCustomerMapJson('{"vm-*": "Contoso", "er-1": ["A", "B"]}')).toEqual([
      { pattern: 'vm-*', customers: ['Contoso'] },
      { pattern: 'er-1', customers: ['A', 'B'] },
    ]);
    expect(parseCustomerMapJson('[{"entity": "x", "customers": "A; B"}]')).toEqual([{ pattern: 'x', customers: ['A', 'B'] }]);
  });

  it('matches whole entities, ignoring case, with * and ?, and adds every match once', () => {
    const map = buildCustomerMap([
      { pattern: 'vm-contoso-*', customers: ['Contoso'] },
      { pattern: 'VM-CONTOSO-WEB-01', customers: ['Contoso', 'Fabrikam'] },
      { pattern: 'db-?', customers: ['Litware'] },
    ]);
    expect(map.size).toBe(3);
    expect(map.lookup('vm-contoso-web-01')).toEqual(['Contoso', 'Fabrikam']);
    expect(map.lookup('vm-contoso-')).toEqual(['Contoso']);
    expect(map.lookup('xvm-contoso-1')).toEqual([]);
    expect(map.lookup('db-1')).toEqual(['Litware']);
    expect(map.lookup('db-12')).toEqual([]);
    expect(map.lookup(null)).toEqual([]);
  });

  it('reports the line and the problem, never the content', () => {
    const fail = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e as Error;
      }
      throw new Error('expected an error');
    };
    const noCustomer = fail(() => parseCustomerMapCsv('entity,customers\nsecret-host,\n'));
    expect(noCustomer).toBeInstanceOf(CustomerMapError);
    expect(noCustomer.message).toBe('CUSTOMER_MAP_FILE: line 2: no customer given.');
    expect(fail(() => parseCustomerMapCsv('*,Everyone')).message).toMatch(/line 1: .*every alert/);
    expect(fail(() => parseCustomerMapCsv('a,"open')).message).toMatch(/line 1: a quote is not closed/);
    expect(fail(() => parseCustomerMapJson('{"secret": 7}')).message).toBe('CUSTOMER_MAP_FILE: entry 1: customers must be a name or a list of names.');
    expect(fail(() => parseCustomerMapJson('not json')).message).toMatch(/not valid JSON/);
  });

  it('loads .csv and .json files and refuses other types and missing files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'customer-map-'));
    try {
      writeFileSync(path.join(dir, 'map.csv'), 'vm-*,Contoso\n');
      writeFileSync(path.join(dir, 'map.json'), '{"vm-*": "Contoso"}');
      writeFileSync(path.join(dir, 'map.txt'), 'vm-*,Contoso\n');
      expect(loadCustomerMap(path.join(dir, 'map.csv')).lookup('vm-1')).toEqual(['Contoso']);
      expect(loadCustomerMap(path.join(dir, 'map.json')).size).toBe(1);
      expect(() => loadCustomerMap(path.join(dir, 'map.txt'))).toThrow(/\.csv or \.json/);
      expect(() => loadCustomerMap(path.join(dir, 'missing.csv'))).toThrow(/cannot be read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds mapped customers to the ones from tags, without duplicates', () => {
    const rules: ExtractionRules = { customerTagPrefixes: ['customer:'], customerCompanyTagPrefixes: [], customerPropertyKeys: [], serviceTagPrefixes: [], servicePropertyKeys: [], serviceFallbackToEntity: true };
    const map = buildCustomerMap([{ pattern: 'vm-contoso-*', customers: ['contoso', 'Fabrikam'] }]);
    const alert = mapAlert(
      { id: 'a1', entity: 'vm-contoso-01', tags: ['customer:Contoso'] },
      { rules, teamNames: new Map(), alertUrl: () => null, customersForEntity: (entity) => map.lookup(entity) },
    );
    expect(alert.customers).toEqual(['Contoso', 'Fabrikam']);
  });
});

// ---- HTTP: health checks and maintenance routes ------------------------------------

const servers: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function serve(options: { writeActions?: ActionId[]; source?: AlertSource; mode?: 'demo' | 'live' } = {}) {
  const base = loadConfig({});
  const config: AppConfig = { ...base, writeActions: options.writeActions ?? [...ACTION_IDS], mode: options.mode ?? 'demo' };
  const demo = new DemoSource(config.extraction, 0, Date.now());
  const store = new AlertStore(options.source ?? demo, 30_000);
  const ops = new DemoOpsContext();
  const maintenance = new MaintenanceService(ops, config.writeActions.includes('maintenance'));
  const server = createApp(config, store, demo, new ActionService(demo, store, config.writeActions), { source: ops, maintenance }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function raw(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path: pathname, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const writeHeaders = { 'content-type': 'application/json', 'x-alert-center-action': '1' };

function newWindow() {
  return {
    description: 'Test window',
    startDate: new Date(Date.now()).toISOString(),
    endDate: new Date(Date.now() + 3_600_000).toISOString(),
    teamId: null,
    rules: [{ entity: { id: 'int-datadog', type: 'integration' }, state: 'disabled' }],
  };
}

describe('health checks', () => {
  it('answer outside /api, whatever the Host, with no details', async () => {
    const base = await serve();
    const health = await raw(`${base}/healthz`, 'GET', { host: 'pod-10-1-2-3:8787' });
    expect(health).toEqual({ status: 200, text: '{"status":"ok"}' });
    expect((await raw(`${base}/readyz`, 'GET', { host: 'pod-10-1-2-3:8787' })).text).toBe('{"status":"ready"}');
    // The API itself still refuses a foreign Host.
    expect((await raw(`${base}/api/status`, 'GET', { host: 'pod-10-1-2-3:8787' })).status).toBe(403);
  });

  it('report "starting" in live mode until the first synchronisation succeeded, and start it once', async () => {
    let syncs = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const source: AlertSource = {
      mode: 'live',
      async sync() {
        syncs += 1;
        await gate;
        return { alerts: new Map<string, AlertDetail>(), truncated: false, skipped: 0 };
      },
      loadHistory: async () => ({ alerts: [], hasNext: false, truncated: false, skipped: 0 }),
      loadDetail: async () => null,
    };
    const base = await serve({ source, mode: 'live' });
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    expect(syncs).toBe(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await (await fetch(`${base}/readyz`)).json()).toEqual({ status: 'ready' });
  });
});

describe('maintenance routes', () => {
  it('create and cancel a window on demo data', async () => {
    const base = await serve();
    const created = await fetch(`${base}/api/maintenances`, { method: 'POST', headers: writeHeaders, body: JSON.stringify(newWindow()) });
    expect(created.status).toBe(201);
    const window = (await created.json()) as { id: string; status: string; rules: Array<{ name: string }> };
    expect(window).toMatchObject({ status: 'active', rules: [{ name: 'Datadog' }] });
    let list = (await (await fetch(`${base}/api/ops/maintenances`)).json()) as MaintenancesResponse;
    expect(list.coverage.map((c) => c.integrationName)).toContain('Datadog');
    const cancelled = await fetch(`${base}/api/maintenances/${window.id}/cancel`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ teamId: null }) });
    expect(cancelled.status).toBe(200);
    list = (await (await fetch(`${base}/api/ops/maintenances`)).json()) as MaintenancesResponse;
    expect(list.maintenances.map((m) => m.id)).not.toContain(window.id);
  });

  it('refuse requests that could come from another web page', async () => {
    const base = await serve();
    const body = JSON.stringify(newWindow());
    expect((await fetch(`${base}/api/maintenances`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(403);
    expect((await fetch(`${base}/api/maintenances`, { method: 'POST', headers: { ...writeHeaders, 'content-type': 'text/plain' }, body })).status).toBe(415);
    expect((await fetch(`${base}/api/maintenances`, { method: 'POST', headers: { ...writeHeaders, origin: 'https://evil.example' }, body })).status).toBe(403);
    expect((await fetch(`${base}/api/maintenances`, { method: 'POST', headers: { ...writeHeaders, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403);
    expect((await fetch(`${base}/api/maintenances/mnt-demo-zabbix/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"teamId":"team-network"}' })).status).toBe(403);
    expect((await fetch(`${base}/api/maintenances`, { method: 'PUT', headers: writeHeaders, body })).status).toBe(405);
    expect((await fetch(`${base}/api/maintenances`, { method: 'POST', headers: writeHeaders, body: '{"description":""}' })).status).toBe(400);
    // Nothing above created a window.
    const list = (await (await fetch(`${base}/api/ops/maintenances`)).json()) as MaintenancesResponse;
    expect(list.maintenances.map((m) => m.description)).not.toContain('Test window');
  });

  it('answer 403 when maintenance is not enabled', async () => {
    const base = await serve({ writeActions: ['acknowledge'] });
    const refused = await fetch(`${base}/api/maintenances`, { method: 'POST', headers: writeHeaders, body: JSON.stringify(newWindow()) });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toMatch(/JIRA_WRITE_ACTIONS/);
    const cancel = await fetch(`${base}/api/maintenances/mnt-demo-zabbix/cancel`, { method: 'POST', headers: writeHeaders, body: '{"teamId":"team-network"}' });
    expect(cancel.status).toBe(403);
  });

  it('serves heartbeats and on-call in demo mode', async () => {
    const base = await serve();
    const beats = (await (await fetch(`${base}/api/ops/heartbeats`)).json()) as { heartbeats: Array<{ status: string }> };
    expect(beats.heartbeats.some((h) => h.status === 'Unresponsive')).toBe(true);
    const onCall = (await (await fetch(`${base}/api/ops/on-call`)).json()) as { schedules: Array<{ onCall: unknown[] }> };
    expect(onCall.schedules.length).toBeGreaterThan(0);
    expect(onCall.schedules.every((s) => s.onCall.length > 0)).toBe(true);
  });
});
