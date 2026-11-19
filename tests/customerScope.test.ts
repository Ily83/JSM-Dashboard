import { describe, expect, it } from 'vitest';
import type { AlertStatus } from '../shared/types';
import { customerOptions, isInScope, scopeAlerts, toggleScope } from '../src/lib/customerScope';

const alert = (id: string, customers: string[], status: AlertStatus = 'open') => ({ id, customers, status });

const alerts = [
  alert('1', ['Contoso']),
  alert('2', ['Fabrikam', 'Contoso'], 'acked'),
  alert('3', ['Fabrikam'], 'closed'),
  alert('4', []),
];

describe('scopeAlerts', () => {
  it('returns the same list when no customer is selected', () => {
    expect(scopeAlerts(alerts, [])).toBe(alerts);
  });

  it('keeps alerts affecting any selected customer, ignoring case', () => {
    expect(scopeAlerts(alerts, ['contoso']).map((a) => a.id)).toEqual(['1', '2']);
    expect(scopeAlerts(alerts, ['Contoso', 'Fabrikam']).map((a) => a.id)).toEqual(['1', '2', '3']);
  });

  it('drops alerts without customers and returns nothing for an unknown customer', () => {
    expect(scopeAlerts(alerts, ['Fabrikam']).map((a) => a.id)).toEqual(['2', '3']);
    expect(scopeAlerts(alerts, ['Northwind'])).toEqual([]);
  });
});

describe('customerOptions', () => {
  it('counts active and total alerts per customer, sorted by name', () => {
    expect(customerOptions(alerts, [])).toEqual([
      { name: 'Contoso', active: 2, total: 2 },
      { name: 'Fabrikam', active: 1, total: 2 },
    ]);
  });

  it('keeps selected customers that currently have no alerts', () => {
    expect(customerOptions(alerts, ['Northwind', 'contoso']).map((o) => [o.name, o.total])).toEqual([
      ['Contoso', 2],
      ['Fabrikam', 2],
      ['Northwind', 0],
    ]);
  });
});

describe('toggleScope', () => {
  it('adds and removes customers without duplicating spellings', () => {
    expect(toggleScope([], 'Contoso')).toEqual(['Contoso']);
    expect(toggleScope(['Contoso', 'Fabrikam'], 'contoso')).toEqual(['Fabrikam']);
    expect(isInScope('FABRIKAM', ['Fabrikam'])).toBe(true);
  });
});
