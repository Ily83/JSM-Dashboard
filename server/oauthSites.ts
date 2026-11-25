/**
 * Which Jira site an Atlassian OAuth grant may be used for (server/oauth.ts).
 * Pure functions over the accessible-resources answer and the token's scopes.
 */

export interface AccessibleResource {
  id: string;
  url: string;
  scopes: string[];
}

/**
 * The scopes granted per resource id, for the resources that are the
 * configured site. Atlassian can list a site's products separately: their
 * scopes are combined only when both the configured URL and the resource ID
 * (when one is configured) match.
 */
export function grantedScopesBySite(resources: readonly AccessibleResource[], siteUrl: string, cloudId: string | null): Map<string, Set<string>> {
  const bySiteId = new Map<string, Set<string>>();
  for (const resource of resources) {
    if (resource.url.replace(/\/$/, '') !== siteUrl || (cloudId && resource.id !== cloudId)) continue;
    const granted = bySiteId.get(resource.id) ?? new Set<string>();
    for (const scope of resource.scopes) granted.add(scope);
    bySiteId.set(resource.id, granted);
  }
  return bySiteId;
}

/**
 * The site scopes accessible-resources must report. The token response can
 * include JSM Operations scopes omitted by accessible-resources: it proves the
 * grant, not the site, so only those scopes are taken from it. The exact
 * resource match and the site-scoped Jira directory permissions stay required.
 */
export function requiredSiteScopes(siteScopes: readonly string[], tokenScopes: ReadonlySet<string>): string[] {
  return siteScopes.filter((scope) => !(scope.includes(':ops-') && scope.endsWith(':jira-service-management') && tokenScopes.has(scope)));
}

/** The first site granted every required scope. */
export function siteWithScopes(bySiteId: ReadonlyMap<string, ReadonlySet<string>>, required: readonly string[]): string | undefined {
  return [...bySiteId].find(([, granted]) => required.every((scope) => granted.has(scope)))?.[0];
}

/** The required scopes missing on the site that misses the fewest (the first such site). `bySiteId` must not be empty. */
export function fewestMissingScopes(bySiteId: ReadonlyMap<string, ReadonlySet<string>>, required: readonly string[]): string[] {
  const [first, ...others] = [...bySiteId.values()].map((granted) => required.filter((scope) => !granted.has(scope)));
  return others.reduce((best, next) => (next.length < best.length ? next : best), first);
}
