/**
 * Where the pipeline writes what it saw of each page, inside the agent's workspace. One owner: the runner writes these
 * files and every operation's prompt names them, so they cannot drift apart.
 */
export const pageSnapshotFile = (index: number): string => `pages/${index}.html`;
export const PAGE_CONTROLS_FILE = "pages/controls.json";
