import { BUILDER_EVENT_NAME, isBuilderScript } from "../../builder-script-marker.ts";
import { VERSION_PLACEHOLDER } from "../../script-artifacts.ts";
import { SECRET_LIKE } from "../../secret-like.ts";
import type { Finding, QaReport } from "../../../../domain/types.ts";
import type { QaInput, QualityGate } from "../../../../ports/index.ts";
import { parseSegments } from "../../segments.ts";
import { analyzeScript, type ScriptRuleOptions, type TransportSpec } from "./script-rules.ts";

/**
 * The contract lint parses script.js with acorn (ES5) and checks it against a closed-world ALLOWLIST of syntax,
 * globals, members and call targets (script-rules.ts); anything not on the list is an error. The list is derived
 * from the skill, the v2 samples, the deliverables and the canned scripts. It is NOT a security boundary: it makes
 * the contract machine-checked and filters hard, and the classes it does not model are listed in README.md. The
 * jsdom poison harness (test/klaviyo/harness.ts) is a second layer for Klaviyo access only; it cannot see string-timer
 * eval, network or navigation. The real boundary is the isolated per-job container (Deferred D6).
 */
export interface ContractLintOptions {
  maxBytes: number;
  /**
   * The one sanctioned way for a script to hand events to Heatmap. Source: Fortune's "Firing Events"
   * doc: window._fireCustomEvent(eventName, 'klaviyo'). Swap here if Heatmap changes the API.
   */
  transport: TransportSpec;
  versionPlaceholder: string;
  /** The name findings are labelled with (the gate name the manifest lists). Default: klaviyo.contract-lint. */
  gateName?: string;
}

export function makeFireCustomEventTransport(destination: string): TransportSpec {
  return {
    description: `window._fireCustomEvent(eventName, "${destination}")`,
    global: "window",
    member: "_fireCustomEvent",
    destination,
  };
}

export const FIRE_CUSTOM_EVENT_TRANSPORT: TransportSpec = makeFireCustomEventTransport("klaviyo");

export const DEFAULT_LINT_OPTIONS: ContractLintOptions = {
  maxBytes: 15 * 1024,
  transport: FIRE_CUSTOM_EVENT_TRANSPORT,
  versionPlaceholder: VERSION_PLACEHOLDER,
};

type Add = (rule: string, message: string, severity?: Finding["severity"], line?: number) => void;

/** Every event name a script can emit. Exact: names are statically constrained (literals, rule-table `event:` values reached through `rule.event`, pass-through helpers). */
export function eventNamesIn(script: string): Set<string> {
  return analyzeScript(script, { transport: FIRE_CUSTOM_EVENT_TRANSPORT, siteSlug: "" }).eventNames;
}

/** Analyzer signature, injectable so a test can force the internal-error path. */
export type ScriptAnalyzer = typeof analyzeScript;

export class ContractLintGate implements QualityGate {
  readonly name: string;

  constructor(
    private readonly options: ContractLintOptions = DEFAULT_LINT_OPTIONS,
    private readonly analyze: ScriptAnalyzer = analyzeScript,
  ) {
    this.name = options.gateName ?? "klaviyo.contract-lint";
  }

  /** Never throws: an unexpected exception inside the analysis becomes an error finding, so the repair loop gets feedback and verify fails cleanly. */
  async review(input: QaInput): Promise<QaReport> {
    return this.run(input, false);
  }

  /**
   * Same checks on the PUBLISHED script, the one with the version stamp already in place (so the placeholder must be gone).
   * Used by the verify step to re-lint what actually went to storage, not the file the agent wrote.
   */
  async reviewPublished(input: QaInput): Promise<QaReport> {
    return this.run(input, true);
  }

  private run(input: QaInput, published: boolean): QaReport {
    const findings: Finding[] = [];
    try {
      this.reviewInto(input, findings, published);
    } catch (e) {
      const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      findings.push({ gate: this.name, rule: "lint-internal-error", severity: "error", message: `The contract lint crashed while analysing the files and refuses them (fail closed): ${text}` });
    }
    return { passed: !findings.some((f) => f.severity === "error"), findings };
  }

  private reviewInto(input: QaInput, findings: Finding[], published: boolean) {
    const add: Add = (rule, message, severity = "error", line) =>
      findings.push({ gate: this.name, rule, severity, message, ...(line ? { line } : {}) });

    const siteSlug = String(input.context.siteSlug ?? "");
    const pinnedEvents = Array.isArray(input.context.pinnedEvents) ? input.context.pinnedEvents.map(String) : [];

    const script = input.files["script.js"];
    const segmentsRaw = input.files["segments.json"];
    if (script === undefined) add("outputs", "script.js is missing");
    if (segmentsRaw === undefined) add("outputs", "segments.json is missing");
    if (input.files["notes.md"] === undefined) add("outputs", "notes.md is missing");

    if (script !== undefined) this.lintScript(script, siteSlug, add, published);

    let segmentEvents: string[] | undefined;
    if (segmentsRaw !== undefined) {
      const parsed = parseSegments(segmentsRaw);
      if (!parsed.ok) parsed.problems.forEach((p) => add("segments-schema", p));
      else segmentEvents = parsed.value.events.map((e) => e.name);
    }
    if (script !== undefined && segmentEvents) this.checkParity(script, segmentEvents, pinnedEvents, add);

    for (const [name, content] of Object.entries(input.files)) {
      if (SECRET_LIKE.test(content)) add("secrets", `${name} contains what looks like a private key (pk_...)`);
    }
  }

  private lintScript(script: string, siteSlug: string, add: Add, published: boolean) {
    const o = this.options;
    const bytes = Buffer.byteLength(script, "utf8");
    if (bytes > o.maxBytes) add("size", `script.js is ${bytes} bytes; budget is ${o.maxBytes}`);

    const ruleOptions: ScriptRuleOptions = { transport: o.transport, siteSlug };
    for (const f of this.analyze(script, ruleOptions).findings) {
      const message = f.rule === "no-direct-klaviyo" || f.rule === "no-global-alias" ? `${f.message}; events go through ${o.transport.description}` : f.message;
      add(f.rule, message, f.severity, f.line);
    }

    const placeholders = script.split(o.versionPlaceholder).length - 1;
    if (published) {
      if (placeholders !== 0) add("version-placeholder", `The published script still contains ${placeholders} ${o.versionPlaceholder} placeholder(s); the version stamp was not applied`);
    } else if (placeholders !== 1) add("version-placeholder", `Expected the ${o.versionPlaceholder} placeholder exactly once, found ${placeholders}`);
  }

  private checkParity(script: string, segmentEvents: string[], pinnedEvents: string[], add: Add) {
    const used = this.analyze(script, { transport: this.options.transport, siteSlug: "" }).eventNames;
    const declared = new Set(segmentEvents);
    const builder = isBuilderScript(script);
    for (const name of used) {
      if (!declared.has(name)) add("event-parity", `Event "${name}" is in script.js but not in segments.json`);
      // Other scripts: snake_case or pinned. The rule-table builder's own Title Case names ("Clicked Search") are accepted only for a script
      // that carries the builder marker AND match BUILDER_EVENT_NAME exactly (checked below), a narrower set than any free-form name.
      const okName = /^[a-z][a-z0-9_]*$/.test(name) || pinnedEvents.includes(name) || (builder && BUILDER_EVENT_NAME.test(name));
      if (!okName) add("event-names", `Event "${name}" must be snake_case or one of the pinned names`);
      // A script that says the rule-table builder wrote it may only carry the builder's own names.
      if (builder && !BUILDER_EVENT_NAME.test(name)) add("event-names", `Event "${name}" is not a name the builder writes ("Clicked <label>", "Scrolled <n> Percent" or "Opened FAQ")`);
    }
    for (const name of declared) {
      if (!used.has(name)) add("event-parity", `Event "${name}" is in segments.json but script.js can never emit it (event names are statically known, so parity is exact)`);
    }
  }
}
