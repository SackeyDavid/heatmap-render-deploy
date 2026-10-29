// JSON site registry for the local Heatmap stand-in. Dev-only. No secrets are stored here.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { SITE_ID_RE, SUB_RE } from "./token.ts";

export interface Site {
  siteId: string;
  userId: string;
  userEmail: string;
  label: string;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function validateSite(input: unknown): { ok: true; site: Site } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "site must be an object" };
  const o = input as Record<string, unknown>;
  if (typeof o.siteId !== "string" || !SITE_ID_RE.test(o.siteId)) return { ok: false, error: "siteId must match [A-Za-z0-9][A-Za-z0-9_-]{0,63} (no dots)" };
  if (typeof o.userId !== "string" || !SUB_RE.test(o.userId)) return { ok: false, error: "userId must match [A-Za-z0-9_-]{1,64}" };
  if (typeof o.userEmail !== "string" || !EMAIL_RE.test(o.userEmail)) return { ok: false, error: "userEmail must look like an email address" };
  const label = o.label === undefined ? o.siteId : o.label;
  if (typeof label !== "string" || label.length < 1 || label.length > 100) return { ok: false, error: "label must be 1..100 characters" };
  return { ok: true, site: { siteId: o.siteId, userId: o.userId, userEmail: o.userEmail, label } };
}

const SEED: Site = { siteId: "example-site", userId: "example-user", userEmail: "owner@example.test", label: "Example site (local seed)" };

export class SiteRegistry {
  constructor(private readonly file: string) {
    if (!existsSync(file)) this.write([SEED]);
  }
  private write(sites: Site[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sites }, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
  list(): Site[] {
    const raw = JSON.parse(readFileSync(this.file, "utf8")) as { sites?: unknown };
    if (!Array.isArray(raw.sites)) throw new Error(`${this.file} must look like { "sites": [...] }`);
    const out: Site[] = [];
    for (const s of raw.sites) {
      const v = validateSite(s);
      if (!v.ok) throw new Error(`${this.file}: invalid site entry: ${v.error}`);
      out.push(v.site);
    }
    return out;
  }
  get(siteId: string): Site | undefined {
    return this.list().find((s) => s.siteId === siteId);
  }
  /** Returns "exists" when the siteId is already registered (never overwrites). */
  add(site: Site): "added" | "exists" {
    const all = this.list();
    if (all.some((s) => s.siteId === site.siteId)) return "exists";
    this.write([...all, site]);
    return "added";
  }
}
