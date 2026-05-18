export type NormalizedAppLink =
  | { kind: 'app'; path: string }
  | { kind: 'external'; href: string }
  | { kind: 'none' };

const APP_HOSTS = new Set([
  'www.theiowacenter-hub.org',
  'theiowacenter-hub.org',
  'iowacenterhubspoke.up.railway.app',
]);

function currentHost(): string | null {
  return typeof globalThis.location?.host === 'string'
    ? globalThis.location.host.toLowerCase()
    : null;
}

function isAppHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return APP_HOSTS.has(normalized) || normalized === currentHost();
}

function toPath(url: URL): string {
  return `${url.pathname || '/'}${url.search}${url.hash}`;
}

function repairMangledAbsoluteLink(value: string): string {
  const withoutLeadingSlashes = value.replace(/^\/+/, '');
  if (/^https?:\/(?!\/)/i.test(withoutLeadingSlashes)) {
    return withoutLeadingSlashes.replace(/^(https?):\/(?!\/)/i, '$1://');
  }
  if (/^https?:\/\//i.test(withoutLeadingSlashes)) {
    return withoutLeadingSlashes;
  }
  if (/^https?:\/(?!\/)/i.test(value)) {
    return value.replace(/^(https?):\/(?!\/)/i, '$1://');
  }
  return value;
}

export function normalizeAppLink(raw: string | null | undefined): NormalizedAppLink {
  const trimmed = raw?.trim();
  if (!trimmed) return { kind: 'none' };

  const repaired = repairMangledAbsoluteLink(trimmed);
  if (repaired.startsWith('/') && !repaired.startsWith('//')) {
    return { kind: 'app', path: repaired };
  }

  try {
    const url = new URL(repaired, globalThis.location?.origin || 'http://localhost');
    if (isAppHost(url.host)) {
      return { kind: 'app', path: toPath(url) };
    }
    return { kind: 'external', href: url.href };
  } catch {
    return { kind: 'none' };
  }
}

export function recoverAppPathFromMangledLocation(raw: string): string | null {
  if (!/^\/+https?:\/{1,2}/i.test(raw.trim())) return null;
  const normalized = normalizeAppLink(raw);
  return normalized.kind === 'app' ? normalized.path : null;
}

export function mapAppPathToPortalPath(appPath: string, token: string): string | null {
  const match = appPath.match(/^\/coordination\/projects\/([^/?#]+)/);
  if (!match) return null;
  const suffix = appPath.slice(match[0].length);
  return `/portal/${encodeURIComponent(token)}/projects/${match[1]}${suffix}`;
}
