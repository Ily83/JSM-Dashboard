import { createPersistentStore } from '../lib/store';
import { sanitizeWorkflows } from '../lib/workflows';

export const WORKFLOWS_KEY = 'workflows:v1';
export const workflowStore = createPersistentStore(WORKFLOWS_KEY, () => [], sanitizeWorkflows);
