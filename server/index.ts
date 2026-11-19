import { createApp } from './app';
import { loadConfig, type AppConfig } from './config';
import { DemoSource } from './demo/demoSource';
import { JiraClient } from './jira/client';
import { JiraOperations } from './jira/operations';
import { JiraSource } from './jira/source';
import { log, setLogLevel } from './logger';
import { AlertStore } from './services/alertStore';
import { ActionService, type AlertOperations } from './services/operations';
import type { AlertSource } from './services/source';

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration.');
  process.exit(1);
}
setLogLevel(config.logLevel);

let source: AlertSource;
let operations: AlertOperations;
if (config.jira) {
  // One client for everything, so concurrency limits and the cloudId are shared.
  const client = new JiraClient(config.jira);
  source = new JiraSource(config.jira, config.extraction, client);
  operations = new JiraOperations(client);
} else {
  const demo = new DemoSource(config.extraction, config.demoAlertCount);
  source = demo;
  operations = demo;
}
const store = new AlertStore(source, config.cacheTtlSeconds * 1000);
const actions = new ActionService(operations, store, config.writeActions);
const app = createApp(config, store, operations, actions);

const server = app.listen(config.port, config.host, () => {
  log.info('alert center backend listening', { url: `http://${config.host}:${config.port}`, mode: config.mode });
  if (config.mode === 'live') {
    log.info('jira integration enabled', { site: config.jira!.siteHost });
    if (config.writeActions.length === 0) log.info('write actions are off (read-only); set JIRA_WRITE_ACTIONS to enable them');
    else log.warn('write actions are ENABLED against Jira', { actions: config.writeActions.join(',') });
  } else {
    log.info('demo mode: sample data, no requests are sent to Jira; actions change the in-memory copy only');
  }
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
