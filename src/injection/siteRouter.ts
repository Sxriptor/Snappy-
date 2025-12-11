/**
 * Lightweight site detection helper for bot routing.
 * Keeps hostname mapping logic out of the renderer injection code.
 */
export type SupportedSite = 'snapchat' | 'threads' | 'reddit' | 'instagram' | 'unknown';

/**
 * Detect which site the active webview is on based on hostname.
 */
export function detectSiteFromHost(hostname: string | null | undefined): SupportedSite {
  if (!hostname) return 'unknown';
  const host = hostname.toLowerCase();

  if (host.includes('threads.net') || host.includes('threads.com')) return 'threads';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('snapchat.com')) return 'snapchat';
  if (host.includes('instagram.com')) return 'instagram';

  return 'unknown';
}

/**
 * Convenience helpers.
 */
export function isThreads(hostname: string | null | undefined): boolean {
  return detectSiteFromHost(hostname) === 'threads';
}

export function isReddit(hostname: string | null | undefined): boolean {
  return detectSiteFromHost(hostname) === 'reddit';
}

export function isSnapchat(hostname: string | null | undefined): boolean {
  return detectSiteFromHost(hostname) === 'snapchat';
}

export function isInstagram(hostname: string | null | undefined): boolean {
  return detectSiteFromHost(hostname) === 'instagram';
}

