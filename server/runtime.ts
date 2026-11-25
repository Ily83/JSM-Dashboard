import express from 'express';
import { createApp } from './app';
import type { AppConfig } from './config';
import { loadCustomerMap } from './customerMap';
import { DemoNotifications } from './demo/demoNotifications';
import { DemoOpsContext } from './demo/demoOpsContext';
import { DemoSource } from './demo/demoSource';
import { JiraClient } from './jira/client';
import { JiraNotifications } from './jira/notifications';
import { JiraOperations } from './jira/operations';
import { JiraOpsContext } from './jira/opsContext';
import { JiraSource } from './jira/source';
import { createOAuthApp, type Bearer, type DesktopAuth } from './oauth';
import { AlertStore } from './services/alertStore';
import { ActionService, type AlertOperations } from './services/operations';
import { NotificationService, type NotificationSource } from './services/notifications';
import { MaintenanceService, type OpsContextSource } from './services/opsContext';
import type { AlertSource } from './services/source';

export function createDashboard(config: AppConfig, desktop?: DesktopAuth) {
  const customerMap = config.customerMapFile ? loadCustomerMap(config.customerMapFile) : null;
  if (customerMap) config.customerMapRules = customerMap.size;

  function dashboard(current: AppConfig, bearer?: Bearer) {
    let source: AlertSource;
    let operations: AlertOperations;
    let opsContext: OpsContextSource;
    let notificationSource: NotificationSource;
    if (current.jira) {
      const client = new JiraClient(current.jira, 4, fetch, bearer);
      const jiraOperations = new JiraOperations(client);
      source = new JiraSource(current.jira, current.extraction, client, customerMap, jiraOperations);
      operations = jiraOperations;
      opsContext = new JiraOpsContext(client, () => jiraOperations.teams(), teamId => jiraOperations.escalations(teamId));
      notificationSource = new JiraNotifications(client);
    } else {
      const demo = new DemoSource(current.extraction, current.demoAlertCount, Date.now(), customerMap);
      source = demo;
      operations = demo;
      opsContext = new DemoOpsContext();
      notificationSource = new DemoNotifications();
    }
    const store = new AlertStore(source, current.cacheTtlSeconds * 1000);
    const actions = new ActionService(operations, store, current.writeActions);
    const maintenance = new MaintenanceService(opsContext, current.writeActions.includes('maintenance'));
    const notifications = new NotificationService(notificationSource, current.writeActions.includes('notifications'));
    return createApp(current, store, operations, actions, { source: opsContext, maintenance, notifications });
  }

  if (config.oauth && config.jira) {
    const jira = config.jira;
    return createOAuthApp(config.oauth, jira, (cloudId, bearer) =>
      dashboard({ ...config, jira: { ...jira, cloudId } }, bearer), fetch, desktop);
  }
  const app = dashboard(config);
  if (!desktop) return app;
  const gate = express();
  gate.disable('x-powered-by');
  gate.use((req, res, next) => {
    if (desktop.isWindow(req)) next();
    else res.sendStatus(403);
  }, app);
  return gate;
}
