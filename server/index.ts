import { loadConfig } from './config';
import { log, setLogLevel } from './logger';
import { createDashboard } from './runtime';

function prepare() {
  try {
    const config = loadConfig();
    setLogLevel(config.logLevel);
    return { config, app: createDashboard(config) };
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not initialize the dashboard.');
    process.exit(1);
  }
}

const { config, app } = prepare();
const server = app.listen(config.port, config.host, () => {
  log.info('alert center backend listening', { url: `http://${config.host}:${config.port}`, mode: config.mode });
  if (config.mode === 'live') {
    log.info('jira integration enabled', { site: config.jira!.siteHost });
    if (config.oauth) log.info('open in your browser to sign in', { url: new URL(config.oauth.redirectUri).origin });
    if (config.writeActions.length === 0) log.info('write actions are off (read-only); set JIRA_WRITE_ACTIONS to enable them');
    else log.warn('write actions are ENABLED against Jira', { actions: config.writeActions.join(',') });
  } else {
    log.info('demo mode: sample data, no requests are sent to Jira; actions change the in-memory copy only');
  }
  if (config.customerMapRules !== undefined) log.info('customer mapping file loaded', { rules: config.customerMapRules });
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
