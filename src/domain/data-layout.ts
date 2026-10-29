import { join } from "node:path";

/**
 * Where things live under the data folder. One owner: the registry's local storage, the HTTP layer's request records,
 * and the local tools that serve what was published all use these, so a folder is never spelled twice.
 */
export const storageDir = (dataDir: string): string => join(dataDir, "storage");
export const requestsDir = (dataDir: string): string => join(dataDir, "requests");
