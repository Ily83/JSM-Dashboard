import { describe, expect, it } from 'vitest';
import { mapAlert, toListItem, type MapContext } from '../server/jira/mapper';
import { RawAlertSchema } from '../server/jira/schemas';

const ctx: MapContext = {
  rules: {
    customerTagPrefixes: ['customer:', 'cust:'],
    customerCompanyTagPrefixes: [],
    customerPropertyKeys: ['customer'],
    serviceTagPrefixes: ['service:'],
    servicePropertyKeys: ['service'],
    serviceFallbackToEntity: true,
  },
  teamNames: new Map([['t1', 'Cloud Operations']]),
  alertUrl: (id) => `https://example.atlassian.net/jira/ops/alerts/${id}`,
};

const raw = (extra: Record<string, unknown>) => RawAlertSchema.parse({ id: 'a1', ...extra });

describe('mapAlert', () => {
  it('derives customers from tag prefixes and extra properties, without duplicates', () => {
    const alert = mapAlert(
      raw({ tags: ['customer:Contoso', 'CUST:Fabrikam', 'prod'], extraProperties: { Customer: 'contoso; Litware , ' } }),
      ctx,
    );
    expect(alert.customers).toEqual(['Contoso', 'Fabrikam', 'Litware']);
    expect(alert.tags).toEqual(['prod']);
    expect(alert.rawTags).toEqual(['customer:Contoso', 'CUST:Fabrikam', 'prod']);
  });

  it('recognizes configured company tags case-insensitively and keeps them as tags', () => {
    const companyCtx = {
      ...ctx,
      rules: { ...ctx.rules, customerCompanyTagPrefixes: ['Acme', 'AcmeCorp', 'Globex'] },
    };
    const alert = mapAlert(raw({
      tags: ['ACME-site', 'acme', 'acmecorp-hq', 'globex', 'acmeextra-site', 'shared-site', 'prod'],
      extraProperties: { customer: 'acme' },
    }), companyCtx);
    expect(alert.customers).toEqual(['Acme', 'AcmeCorp', 'Globex']);
    expect(alert.tags).toEqual(['ACME-site', 'acme', 'acmecorp-hq', 'globex', 'acmeextra-site', 'shared-site', 'prod']);
  });

  it('takes the service from a tag, then a property, then the entity', () => {
    expect(mapAlert(raw({ extraProperties: { service: 'Billing' }, tags: ['service:Other'], entity: 'vm-1' }), ctx).service).toBe('Other');
    expect(mapAlert(raw({ extraProperties: { service: 'Billing' }, entity: 'vm-1' }), ctx).service).toBe('Billing');
    expect(mapAlert(raw({ entity: 'vm-1' }), ctx).service).toBe('vm-1');
    expect(mapAlert(raw({}), ctx).service).toBeNull();
  });

  it('normalises status from the status string and the boolean flags', () => {
    expect(mapAlert(raw({ status: 'open' }), ctx).status).toBe('open');
    expect(mapAlert(raw({ status: 'open', acknowledged: true }), ctx).status).toBe('acked');
    expect(mapAlert(raw({ status: 'acked' }), ctx).status).toBe('acked');
    expect(mapAlert(raw({ status: 'open', snoozed: true }), ctx).status).toBe('snoozed');
    expect(mapAlert(raw({ status: 'resolved' }), ctx).status).toBe('closed');
    expect(mapAlert(raw({ status: 'closed', acknowledged: true }), ctx).status).toBe('closed');
  });

  it('survives a nearly empty alert', () => {
    const alert = mapAlert(raw({}), ctx);
    expect(alert).toMatchObject({ summary: '(no summary)', priority: 'P3', count: 1, customers: [], assignee: null, source: 'Unknown' });
    expect(alert.detailLoaded).toBe(false);
  });

  it('names team responders and keeps other responders by id', () => {
    const alert = mapAlert(raw({ responders: [{ id: 't1', type: 'team' }, { id: 'u1', type: 'user' }] }), ctx);
    expect(alert.responders).toEqual([{ id: 't1', type: 'team', name: 'Cloud Operations' }, { id: 'u1', type: 'user' }]);
  });

  it('keeps unknown fields out of the list item and detail-only fields out of it too', () => {
    const item = toListItem(mapAlert(raw({ description: 'secret detail', extraProperties: { a: 'b' } }), ctx));
    expect(item).not.toHaveProperty('description');
    expect(item).not.toHaveProperty('extraProperties');
    expect(item.url).toBe('https://example.atlassian.net/jira/ops/alerts/a1');
  });

  it('rejects an alert without an id', () => {
    expect(RawAlertSchema.safeParse({ message: 'no id' }).success).toBe(false);
  });
});
