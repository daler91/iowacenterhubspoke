import {
  mapAppPathToPortalPath,
  normalizeAppLink,
  recoverAppPathFromMangledLocation,
} from './appLinks';

describe('normalizeAppLink', () => {
  it.each([
    [
      'https://www.theiowacenter-hub.org/coordination/projects/p-1',
      { kind: 'app', path: '/coordination/projects/p-1' },
    ],
    [
      'https://theiowacenter-hub.org/coordination/projects/p-1?tab=messages#latest',
      { kind: 'app', path: '/coordination/projects/p-1?tab=messages#latest' },
    ],
    [
      'https://iowacenterhubspoke.up.railway.app/coordination/projects/p-1',
      { kind: 'app', path: '/coordination/projects/p-1' },
    ],
    [
      '/coordination/projects/p-1',
      { kind: 'app', path: '/coordination/projects/p-1' },
    ],
    [
      '/https:/www.theiowacenter-hub.org/coordination/projects/p-1',
      { kind: 'app', path: '/coordination/projects/p-1' },
    ],
    [
      'https:/www.theiowacenter-hub.org/coordination/projects/p-1',
      { kind: 'app', path: '/coordination/projects/p-1' },
    ],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeAppLink(raw)).toEqual(expected);
  });

  it('keeps external links external', () => {
    expect(normalizeAppLink('https://example.org/coordination/projects/p-1')).toEqual({
      kind: 'external',
      href: 'https://example.org/coordination/projects/p-1',
    });
  });

  it('returns none for blank input', () => {
    expect(normalizeAppLink('   ')).toEqual({ kind: 'none' });
  });
});

describe('recoverAppPathFromMangledLocation', () => {
  it('repairs a router-mangled app URL path', () => {
    expect(
      recoverAppPathFromMangledLocation('/https:/www.theiowacenter-hub.org/coordination/projects/p-1'),
    ).toBe('/coordination/projects/p-1');
  });

  it('ignores normal unmatched relative paths', () => {
    expect(recoverAppPathFromMangledLocation('/not-a-real-route')).toBeNull();
  });
});

describe('mapAppPathToPortalPath', () => {
  it('maps internal project paths to the active portal token', () => {
    expect(mapAppPathToPortalPath('/coordination/projects/p-1', 'portal-token')).toBe(
      '/portal/portal-token/projects/p-1',
    );
  });

  it('preserves query and hash suffixes', () => {
    expect(
      mapAppPathToPortalPath('/coordination/projects/p-1?tab=messages#latest', 'portal-token'),
    ).toBe('/portal/portal-token/projects/p-1?tab=messages#latest');
  });
});
