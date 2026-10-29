const PREF_KEY = 'heatmap-helper-pref';

export type HelperPref = 'on' | 'off';

export function readHelperPref(): HelperPref | null {
  try {
    const v = window.sessionStorage.getItem(PREF_KEY);
    if (v === 'on' || v === 'off') return v;
  } catch {
    /* private mode */
  }
  return null;
}

export function writeHelperPref(pref: HelperPref): void {
  try {
    window.sessionStorage.setItem(PREF_KEY, pref);
  } catch {
    /* ignore */
  }
}
