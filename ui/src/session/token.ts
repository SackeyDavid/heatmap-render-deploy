const KEY = 'heatmap-session';

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads the sign-in value from the page address once, keeps it for this tab, and removes it from the address bar. */
export function captureToken(): void {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl === null) return;
  if (fromUrl) storage()?.setItem(KEY, fromUrl);
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function getToken(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function clearToken(): void {
  storage()?.removeItem(KEY);
}

function decodeExp(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** True when there is a stored value that has not visibly expired. The server still decides. */
export function hasUsableToken(now: number = Date.now()): boolean {
  const token = getToken();
  if (!token) return false;
  const exp = decodeExp(token);
  return exp === null || exp * 1000 > now;
}
