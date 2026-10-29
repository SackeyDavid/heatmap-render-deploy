/**
 * A job id becomes a file name (job store) and a folder name (workspace), so it is a plain token: letters, digits, dot,
 * underscore, hyphen, starting with a letter or digit. No separators, so it cannot name a path outside its folder.
 * One owner: the application checks ids it is given, and the adapters that use ids as paths check the same rule.
 */
export const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function assertSafeJobId(id: string): void {
  if (!JOB_ID_RE.test(id)) throw new Error(`Invalid job id: ${JSON.stringify(id).slice(0, 60)}`);
}
