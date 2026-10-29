import { getToken } from './token';

export interface SessionClaims {
  siteId: string | null;
  email: string | null;
}

function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Best-effort read of site and email from the stored sign-in value. The server still decides. */
export function readSessionClaims(): SessionClaims {
  const token = getToken();
  if (!token) return { siteId: null, email: null };
  const payload = decodePayload(token);
  if (!payload) return { siteId: null, email: null };
  const siteId = typeof payload.siteId === 'string' ? payload.siteId : null;
  const email = typeof payload.email === 'string' ? payload.email : null;
  return { siteId, email };
}
