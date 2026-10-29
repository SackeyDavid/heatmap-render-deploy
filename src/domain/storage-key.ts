/** A key is a relative, forward-slash path with no ".." anywhere. One owner: every RemoteStorage adapter applies this rule before touching anything. */
export function assertSafeStorageKey(key: string): void {
  if (key === "" || key.startsWith("/") || key.includes("..") || key.includes("\\")) throw new Error(`Invalid storage key: ${key}`);
}

/**
 * The text a pointer file holds after moving to `target`: the target, plus the version it replaced (when the old pointer
 * is readable) so a rollback knows where to go. One owner: every RemoteStorage adapter's pin() writes exactly this.
 */
export function pointerDocument(existingText: string | null, target: { version: string }): string {
  let previous: string | undefined;
  if (existingText) {
    try {
      previous = (JSON.parse(existingText) as { version?: string }).version;
    } catch {
      previous = undefined;
    }
  }
  return JSON.stringify({ ...target, ...(previous ? { previous } : {}) }, null, 2);
}
