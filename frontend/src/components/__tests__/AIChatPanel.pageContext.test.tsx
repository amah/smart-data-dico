import { describe, expect, it } from 'vitest';
import { getPageContext } from '../AIChatPanel';

describe('getPageContext', () => {
  it('returns an entity context for /packages/<pkg>/entities/<name>', () => {
    expect(getPageContext('/packages/order-service/entities/Order'))
      .toBe('Currently viewing entity Order in package order-service.');
  });

  it('returns a package context for /packages/<pkg>', () => {
    expect(getPageContext('/packages/order-service'))
      .toBe('Currently viewing package order-service.');
  });

  it('tolerates a trailing slash on the package route', () => {
    expect(getPageContext('/packages/order-service/'))
      .toBe('Currently viewing package order-service.');
  });

  it('returns a perspective context for /packages/<pkg>/perspectives/<name>', () => {
    expect(getPageContext('/packages/order-service/perspectives/Checkout'))
      .toBe('Currently viewing perspective Checkout in package order-service.');
  });

  it('decodes URL-encoded segments', () => {
    expect(getPageContext('/packages/order%20service/entities/Order%20Line'))
      .toBe('Currently viewing entity Order Line in package order service.');
  });

  it('returns empty string for unrelated routes', () => {
    expect(getPageContext('/settings')).toBe('');
    expect(getPageContext('/')).toBe('');
    expect(getPageContext('/diagram')).toBe('');
    expect(getPageContext('/packages')).toBe('');
  });

  it('returns empty string for sub-routes that are not exactly entity/perspective leaves', () => {
    // e.g. an attribute detail page nested deeper than the documented patterns
    expect(getPageContext('/packages/order-service/entities/Order/attributes/orderId')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(getPageContext('')).toBe('');
  });
});
