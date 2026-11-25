/**
 * The settings of the configuration file (.env) that the desktop app can edit
 * from its own window. Everything else stays a hand edit of the file: write
 * actions (the read-only safety switch), the port and host, the OAuth callback
 * and the tuning values.
 */

export type ConfigFieldKind = 'text' | 'secret' | 'number' | 'list' | 'toggle' | 'choice';
export type ConfigGroup = 'connection' | 'extraction' | 'alerts';

export interface ConfigFieldDefinition {
  key: string;
  label: string;
  group: ConfigGroup;
  kind: ConfigFieldKind;
  /** What applies when the file does not set it, as it would be typed. */
  fallback?: string;
  choices?: ReadonlyArray<{ value: string; label: string }>;
  /** Shown only for this sign-in method. */
  auth?: 'basic' | 'oauth';
}

export const CONFIG_GROUPS: ReadonlyArray<{ id: ConfigGroup; title: string }> = [
  { id: 'connection', title: 'Jira connection' },
  { id: 'extraction', title: 'Customers and services' },
  { id: 'alerts', title: 'Alerts loaded' },
];

export const AUTH_MODE_KEY = 'JIRA_AUTH_MODE';
export const SITE_URL_KEY = 'JIRA_SITE_URL';

export const CONFIG_FIELDS: readonly ConfigFieldDefinition[] = [
  { key: 'DEMO_MODE', label: 'Use sample data', group: 'connection', kind: 'toggle', fallback: 'false' },
  { key: SITE_URL_KEY, label: 'Jira site', group: 'connection', kind: 'text' },
  {
    key: AUTH_MODE_KEY, label: 'Sign-in', group: 'connection', kind: 'choice', fallback: 'basic',
    choices: [{ value: 'oauth', label: 'Atlassian sign-in (OAuth)' }, { value: 'basic', label: 'API token' }],
  },
  { key: 'JIRA_OAUTH_CLIENT_ID', label: 'OAuth client ID', group: 'connection', kind: 'text', auth: 'oauth' },
  { key: 'JIRA_OAUTH_CLIENT_SECRET', label: 'OAuth client secret', group: 'connection', kind: 'secret', auth: 'oauth' },
  { key: 'JIRA_EMAIL', label: 'Account email', group: 'connection', kind: 'text', auth: 'basic' },
  { key: 'JIRA_API_TOKEN', label: 'API token', group: 'connection', kind: 'secret', auth: 'basic' },

  { key: 'CUSTOMER_TAG_PREFIXES', label: 'Customer tag prefixes', group: 'extraction', kind: 'list', fallback: 'customer:, customer=, cust:' },
  { key: 'CUSTOMER_COMPANY_TAG_PREFIXES', label: 'Company names in tags', group: 'extraction', kind: 'list' },
  { key: 'CUSTOMER_PROPERTY_KEYS', label: 'Customer property keys', group: 'extraction', kind: 'list', fallback: 'customer, customers' },
  { key: 'SERVICE_TAG_PREFIXES', label: 'Service tag prefixes', group: 'extraction', kind: 'list', fallback: 'service:, service=' },
  { key: 'SERVICE_PROPERTY_KEYS', label: 'Service property keys', group: 'extraction', kind: 'list', fallback: 'service' },
  { key: 'SERVICE_FALLBACK_TO_ENTITY', label: 'Use the entity as service', group: 'extraction', kind: 'toggle', fallback: 'true' },
  { key: 'CUSTOMER_MAP_FILE', label: 'Customer mapping file', group: 'extraction', kind: 'text' },

  { key: 'JIRA_ALERT_QUERY', label: 'Extra alert query', group: 'alerts', kind: 'text' },
  { key: 'JIRA_OPEN_QUERY', label: 'Open alerts query', group: 'alerts', kind: 'text', fallback: 'status: open' },
  { key: 'JIRA_CLOSED_QUERY', label: 'Closed alerts query', group: 'alerts', kind: 'text', fallback: 'NOT status: open' },
  { key: 'JIRA_MAX_ALERTS', label: 'Open alerts to load', group: 'alerts', kind: 'number', fallback: '2000' },
  { key: 'JIRA_MAX_CLOSED_ALERTS', label: 'Closed alerts to load', group: 'alerts', kind: 'number', fallback: '500' },
  { key: 'JIRA_CLOSED_LOOKBACK_HOURS', label: 'Closed alert lookback (hours)', group: 'alerts', kind: 'number', fallback: '72' },
  { key: 'JIRA_ALERT_URL_TEMPLATE', label: '“Open in Jira” link', group: 'alerts', kind: 'text', fallback: '{siteUrl}/jira/ops/alerts/{id}' },
];

/** The route of the page that shows only these settings; reachable while signed out. */
export const SETUP_PATH = '/setup';
export const DESKTOP_CONFIG_API = '/api/desktop/config';

export interface ConfigFieldState {
  key: string;
  /** The value in the file; always null for a secret. */
  value: string | null;
  /** Whether the file (or the environment) has a value. */
  set: boolean;
  /** Set by the computer's environment, which wins over the file: not editable here. */
  locked: boolean;
}

export interface DesktopConfigResponse {
  /** Where the configuration file is, for the operator. */
  file: string;
  /** False when the app runs from fixed settings and nothing can be saved. */
  editable: boolean;
  mode: 'demo' | 'live';
  oauth: boolean;
  /** The callback address to register in the Atlassian OAuth app. */
  callbackUrl: string;
  fields: ConfigFieldState[];
  warnings: string[];
}

export interface DesktopConfigSaveRequest {
  /** Only the settings to change. An empty string or null removes the setting from the file. */
  values: Record<string, string | null>;
}

export interface DesktopConfigSaveResponse extends DesktopConfigResponse {
  /** The address the window must open now; it changes with the sign-in method. */
  origin: string;
}
