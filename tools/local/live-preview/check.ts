/** `--check`: compares the READ-OUT JSON from the browser with the events the last build produced. */

export interface ReadOut {
  hCT: string[];
  bridge: string[];
  tagsCalls: number;
  identityCalls: number;
  fireCustomEvent: boolean;
  klaId: boolean;
  scrollPercent: number;
  /** Event names the builder script itself logged (present when the inject snippet ran first). */
  builderLogged?: string[];
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function parseReadOut(raw: unknown): ReadOut {
  const o = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (typeof o !== "object" || o === null) throw new Error("read-out must be a JSON object");
  const r = o as Record<string, unknown>;
  if (!strings(r.hCT) || !strings(r.bridge)) throw new Error("read-out needs string lists hCT and bridge");
  if (typeof r.tagsCalls !== "number" || typeof r.identityCalls !== "number") throw new Error("read-out needs numbers tagsCalls and identityCalls");
  if (typeof r.fireCustomEvent !== "boolean" || typeof r.klaId !== "boolean") throw new Error("read-out needs booleans fireCustomEvent and klaId");
  if (r.builderLogged !== undefined && !strings(r.builderLogged)) throw new Error("builderLogged must be a list of strings");
  return {
    hCT: r.hCT,
    bridge: r.bridge,
    tagsCalls: r.tagsCalls,
    identityCalls: r.identityCalls,
    fireCustomEvent: r.fireCustomEvent,
    klaId: r.klaId,
    scrollPercent: typeof r.scrollPercent === "number" ? r.scrollPercent : 0,
    builderLogged: r.builderLogged as string[] | undefined,
  };
}

/** snake_case form of a name: "Clicked 15 Minutes to Fit" and "clicked_15_minutes_to_fit" give the same result. */
export const normalizeName = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export interface EventCheck {
  event: string;
  /** Heatmap accepted the call under the builder's name (hCT_ marker). */
  fired: boolean;
  /** Heatmap handed that name to the Klaviyo bridge. */
  bridge: boolean;
  /** A second spelling of the same name (for example Title Case) also exists: Heatmap fires both forms. Informational. */
  bothForms: boolean;
  /** The builder script's own console line was seen; null when the read-out has no such list. */
  builderCalled: boolean | null;
}

export interface CheckResult {
  perEvent: EventCheck[];
  pass: boolean;
  lines: string[];
}

export function checkReadOut(events: string[], r: ReadOut): CheckResult {
  const forms = (list: string[], e: string) => new Set(list.filter((n) => normalizeName(n) === normalizeName(e))).size;
  const perEvent: EventCheck[] = events.map((event) => ({
    event,
    fired: r.hCT.includes(event),
    bridge: r.bridge.includes(event),
    bothForms: forms(r.hCT, event) >= 2,
    builderCalled: r.builderLogged ? r.builderLogged.includes(event) : null,
  }));
  const pf = (b: boolean) => (b ? "PASS" : "FAIL");
  const lines: string[] = [];
  lines.push(`Heatmap helper (window._fireCustomEvent) is a function: ${pf(r.fireCustomEvent)}`);
  lines.push(`Visit looked identified (klaviyo_identity calls: ${r.identityCalls}, __kla_id cookie: ${r.klaId})`);
  lines.push(`Heatmap request=tags calls seen: ${r.tagsCalls}`);
  for (const e of perEvent) {
    lines.push(`- ${e.event}`);
    lines.push(`    fired in browser (hCT_ marker):        ${pf(e.fired)}`);
    lines.push(`    handed to Klaviyo bridge:              ${pf(e.bridge)}`);
    lines.push(`    both name forms present (info only):   ${pf(e.bothForms)}`);
    if (e.builderCalled !== null) lines.push(`    builder script logged the call:        ${pf(e.builderCalled)}`);
  }
  const anon = !r.klaId && r.identityCalls === 0;
  const pass = r.fireCustomEvent && perEvent.length > 0 && perEvent.every((e) => e.fired && e.bridge);
  lines.push("");
  if (anon) lines.push("Note: this looks like an anonymous visit (no Klaviyo identity). Heatmap hands events to the Klaviyo bridge only for an identified visit, so 'handed to Klaviyo bridge' is expected to FAIL here. Open the site from a Klaviyo email link and repeat.");
  if (r.builderLogged === undefined) lines.push("Note: the read-out has no builderLogged list (the inject snippet was not run first), so a marker may come from the page's own v2 script, not from this build.");
  lines.push(
    pass
      ? "VERDICT: PASS in the browser. The builder's events went through the real Heatmap and were handed to the Klaviyo bridge. This does NOT confirm Klaviyo itself: open the Klaviyo Activity feed of the test profile and confirm the events there, and ask Ryan to confirm."
      : "VERDICT: FAIL in the browser. At least one built event did not go through Heatmap and the Klaviyo bridge (see the lines above). Klaviyo itself must still be confirmed in the Klaviyo Activity feed once the browser side passes.",
  );
  return { perEvent, pass, lines };
}
