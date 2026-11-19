import { createApp } from './app';
import { loadConfig, type AppConfig } from './config';
import { DemoSource } from './demo/demoSource';
import { JiraSource } from './jira/source';
import { log, setLogLevel } from './logger';
import { AlertStore } from './services/alertStore';

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration.');
  process.exit(1);
}
setLogLevel(config.logLevel);

const source = config.jira
  ? new JiraSource(config.jira, config.extraction)
  : new DemoSource(config.extraction, config.demoAlertCount);
const store = new AlertStore(source, config.cacheTtlSeconds * 1000);
const app = createApp(config, store);

const server = app.listen(config.port, config.host, () => {
  log.info('alert center backend listening', { url: `http://${config.host}:${config.port}`, mode: config.mode });
  if (config.mode === 'live') log.info('jira integration enabled (read-only)', { site: config.jira!.siteHost });
  else log.info('demo mode: sample data, no requests are sent to Jira');
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
