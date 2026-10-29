import { join } from "node:path";

/** The shape of a request id (`req-` plus lowercase letters and digits). One owner: the HTTP layer issues and checks ids, and composition uses it to keep a per-request folder name safe. */
export const REQUEST_ID_RE = /^req-[a-z0-9]{8,32}$/;

/**
 * The one folder holding the saved pages a request uploaded: the HTTP layer writes it, the saved-html page inspector
 * (scoped to the request by the registry) reads it. Both use this function, so they cannot drift apart.
 */
export function requestPagesDir(dataDir: string, requestId: string): string {
  return join(dataDir, "pages", requestId);
}
