import { spawn } from 'node:child_process';
import path from 'node:path';
import { createApp } from './app';
import { loadConfig, type AppConfig } from './config';
import { CustomerMapError, loadCustomerMap, type CustomerMap } from './customerMap';
import { DemoOpsContext } from './demo/demoOpsContext';
import { DemoSource } from './demo/demoSource';
import { JiraClient } from './jira/client';
import { JiraOperations } from './jira/operations';
import { JiraOpsContext } from './jira/opsContext';
import { JiraSource } from './jira/source';
import { log, setLogLevel } from './logger';
import { createOAuthApp, type Bearer } from './oauth';
import { AlertStore } from './services/alertStore';
import { ActionService, type AlertOperations } from './services/operations';
import { MaintenanceService, type OpsContextSource } from './services/opsContext';
import type { AlertSource } from './services/source';

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration.');
  process.exit(1);
}
setLogLevel(config.logLevel);

// Optional entity -> customer mapping, validated before anything starts.
let customerMap: CustomerMap | null = null;
if (config.customerMapFile) {
  try {
    customerMap = loadCustomerMap(config.customerMapFile);
    config.customerMapRules = customerMap.size;
  } catch (error) {
    console.error(error instanceof CustomerMapError ? error.message : 'CUSTOMER_MAP_FILE could not be loaded.');
    process.exit(1);
  }
}

function dashboard(config: AppConfig, bearer?: Bearer) {
  let source: AlertSource;
  let operations: AlertOperations;
  let opsContext: OpsContextSource;
  if (config.jira) {
    const client = new JiraClient(config.jira, 4, fetch, bearer);
    source = new JiraSource(config.jira, config.extraction, client, customerMap);
    const jiraOperations = new JiraOperations(client);
    operations = jiraOperations;
    opsContext = new JiraOpsContext(client, () => jiraOperations.teams(), (teamId) => jiraOperations.escalations(teamId));
  } else {
    const demo = new DemoSource(config.extraction, config.demoAlertCount, Date.now(), customerMap);
    source = demo;
    operations = demo;
    opsContext = new DemoOpsContext();
  }
  const store = new AlertStore(source, config.cacheTtlSeconds * 1000);
  const actions = new ActionService(operations, store, config.writeActions);
  const maintenance = new MaintenanceService(opsContext, config.writeActions.includes('maintenance'));
  return createApp(config, store, operations, actions, { source: opsContext, maintenance });
}

const app = config.oauth && config.jira
  ? createOAuthApp(config.oauth, config.jira, (cloudId, bearer) => dashboard({ ...config, jira: { ...config.jira!, cloudId } }, bearer))
  : dashboard(config);

const portable = process.argv.includes('--portable');
const browserOrigin = config.oauth ? new URL(config.oauth.redirectUri).origin : `http://localhost:${config.port}`;
if (portable && (config.host !== '127.0.0.1' || Number(new URL(browserOrigin).port || 80) !== config.port)) {
  console.error('Portable mode requires HOST=127.0.0.1 and an OAuth callback on the same PORT as the dashboard.');
  process.exit(1);
}
const server = app.listen(config.port, config.host, () => {
  if (portable) {
    console.info(`Open ${browserOrigin} in your work browser.`);
    // Only open the browser once this instance owns the port, including in signed-out OAuth mode.
    if (process.platform === 'win32' && process.env.JSM_NO_BROWSER !== '1') {
      const explorer = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe');
      spawn(explorer, [browserOrigin], { stdio: 'ignore' }).on('error', () => console.error('Could not open the browser automatically.'));
    }
  }
  log.info('alert center backend listening', { url: `http://${config.host}:${config.port}`, mode: config.mode });
  if (config.mode === 'live') {
    log.info('jira integration enabled', { site: config.jira!.siteHost });
    if (config.oauth) log.info('open in your browser to sign in', { url: new URL(config.oauth.redirectUri).origin });
    if (config.writeActions.length === 0) log.info('write actions are off (read-only); set JIRA_WRITE_ACTIONS to enable them');
    else log.warn('write actions are ENABLED against Jira', { actions: config.writeActions.join(',') });
  } else {
    log.info('demo mode: sample data, no requests are sent to Jira; actions change the in-memory copy only');
  }
  if (customerMap) log.info('customer mapping file loaded', { rules: customerMap.size });
  for (const warning of config.warnings) log.warn(warning);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Set PORT in .env to another port.`);
  } else {
    console.error(`Could not start the server: ${error.code ?? error.name}`);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
