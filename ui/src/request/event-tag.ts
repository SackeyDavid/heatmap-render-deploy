const KEY = 'eventTag';
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Test sites only: opening the app with ?tag=kenn-test makes the server end every event name with " (kenn-test)".
 * Remembered for the tab so it survives the sign-in redirect; merchants never see or need it.
 */
export function rememberEventTag(search: string = window.location.search): void {
  const tag = new URLSearchParams(search).get('tag');
  if (tag === null) return;
  const s = store();
  if (!s) return;
  try {
    if (TAG_RE.test(tag)) s.setItem(KEY, tag);
    else s.removeItem(KEY);
  } catch {
    // storage unavailable: the tag is simply off
  }
}

export function getEventTag(): string | null {
  try {
    const v = store()?.getItem(KEY) ?? null;
    return v !== null && TAG_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}
