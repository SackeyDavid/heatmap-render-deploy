export interface SegmentEvent {
  name: string;
  trigger: string;
  once?: string;
  pages?: string[];
}

export interface SegmentDef {
  name: string;
  conditions: string;
}

export interface SegmentsFile {
  events: SegmentEvent[];
  segments: SegmentDef[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses segments.json. Returns the file or a list of problems. */
export function parseSegments(json: string): { ok: true; value: SegmentsFile } | { ok: false; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, problems: [`segments.json is not valid JSON: ${(e as Error).message}`] };
  }
  const problems: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ["segments.json must be an object"] };
  const { events, segments } = raw;
  if (!Array.isArray(events) || events.length === 0) problems.push("events must be a non-empty array");
  if (!Array.isArray(segments)) problems.push("segments must be an array");
  if (problems.length > 0) return { ok: false, problems };

  const outEvents: SegmentEvent[] = [];
  (events as unknown[]).forEach((e, i) => {
    if (!isRecord(e) || typeof e.name !== "string" || typeof e.trigger !== "string") {
      problems.push(`events[${i}] needs string "name" and "trigger"`);
      return;
    }
    outEvents.push({
      name: e.name,
      trigger: e.trigger,
      once: typeof e.once === "string" ? e.once : undefined,
      pages: Array.isArray(e.pages) ? e.pages.filter((p): p is string => typeof p === "string") : undefined,
    });
  });
  const outSegments: SegmentDef[] = [];
  (segments as unknown[]).forEach((s, i) => {
    if (!isRecord(s) || typeof s.name !== "string" || typeof s.conditions !== "string") {
      problems.push(`segments[${i}] needs string "name" and "conditions"`);
      return;
    }
    outSegments.push({ name: s.name, conditions: s.conditions });
  });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { events: outEvents, segments: outSegments } };
}
