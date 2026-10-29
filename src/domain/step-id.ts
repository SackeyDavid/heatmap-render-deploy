/**
 * A step in a running job is named "<position>:<kind>" (for example "3:publish"); the first one, "validate", has no
 * position. One owner: the runner builds ids, breakpoints and the HTTP failure wording read them back.
 */
export const stepId = (index: number, kind: string): string => `${index}:${kind}`;

/** The kind part of a step id ("3:publish" -> "publish"); an id with no position is its own kind. */
export const stepKind = (id: string): string => (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);
