// Static event names. The only value a script sends to Heatmap/Klaviyo is the event NAME (properties are dropped by
// track()), so the lint makes the name statically knowable:
//   (a) a string literal, or a concatenation/fold of literals and constants only;
//   (b) `<record>.event` where <record> is an object literal inside a read-only rule table
//       (var RULES = [{ ..., event: "x" }, ...]; RULES.forEach(function (rule) { track(rule.event); }));
//   (c) inside a helper, a name-bearing parameter passed on unchanged.
// A helper parameter is "name-bearing" when it flows (through any chain of local helpers) into track()'s first
// argument; call sites of such helpers are checked exactly like track() call sites. Anything else (DOM or BOM
// reads, .value, textContent, getAttribute, location, sessionStorage reads, a loop variable, `+` with a
// non-constant) is an error that names the construct. The same flow gives selector strings the same treatment.
//
// Limits (stated, not hidden): this proves the name comes from a literal in the script; it does not prove the
// literal is a good name, and it does not stop a script from firing many different literal names (capped at
// MAX_EVENT_NAMES distinct names, MAX_EVENT_NAME_LENGTH characters each).
import type { Node } from "acorn";
import type { Analysis, Binding } from "./script-rules.ts";

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes are walked structurally
type N = Node & Record<string, any>;

export const MAX_EVENT_NAME_LENGTH = 80;
export const MAX_EVENT_NAMES = 50;

export type AddFinding = (rule: string, message: string, node?: N, severity?: "error" | "warn") => void;

export interface NameFlowResult {
  /** Every event name that can reach track(): exact, no computed names exist. */
  names: Set<string>;
  /** Rule-table `event:` literals never reached by a track() call. */
  unreached: string[];
}

const KEYS_TRACKED = ["event", "selector"] as const;

export class NameFlow {
  private readonly readOnlyMemo = new Map<Binding, boolean>();
  /** Records whose `.event` is read as a name. */
  readonly reachedRecords = new Set<N>();

  constructor(
    private readonly an: Analysis,
    private readonly source: string,
    private readonly use: (name: string) => void,
  ) {}

  private text(n: N): string {
    return this.source.slice(n.start, n.end).replace(/\s+/g, " ").slice(0, 60);
  }

  // ---------- rule tables: read-only var holding an array of object literals, or one object literal

  /** All references to the binding are plain reads of the table: T.length, T.forEach(fn), T[<numeric>], or o.prop for a record. */
  private readOnlyRoot(b: Binding): boolean {
    const memo = this.readOnlyMemo.get(b);
    if (memo !== undefined) return memo;
    let ok = b.kind === "var" && b.decls.length === 1 && b.inits.length === 1 && b.assigns.length === 0 && b.updates.length === 0;
    if (ok) {
      const isArray = b.inits[0]!.type === "ArrayExpression";
      for (const [id, bound] of this.an.refBinding) {
        if (bound !== b) continue;
        const p = this.an.parent.get(id);
        if (!p || p.type !== "MemberExpression" || p.object !== id) {
          ok = false;
          break;
        }
        const pp = this.an.parent.get(p);
        const written = (pp?.type === "AssignmentExpression" && pp.left === p) || pp?.type === "UpdateExpression";
        const called = pp?.type === "CallExpression" && pp.callee === p;
        if (written) ok = false;
        else if (p.computed) ok = isArray && this.an.isNumeric(p.property) && !called;
        else if (isArray) ok = (p.property.name === "length" && !called) || (p.property.name === "forEach" && called);
        else ok = !called;
        if (!ok) break;
      }
    }
    this.readOnlyMemo.set(b, ok);
    return ok;
  }

  /** The var binding that holds the table this object literal is part of (var T = [ {..}, ..] or var o = {..}), when it is a read-only root. */
  private rootOf(obj: N): Binding | undefined {
    let top: N = obj;
    for (let p = this.an.parent.get(top); p && (p.type === "ArrayExpression" || p.type === "ObjectExpression" || p.type === "Property"); p = this.an.parent.get(top)) top = p;
    const decl = this.an.parent.get(top);
    if (decl?.type !== "VariableDeclarator" || decl.init !== top) return undefined;
    const b = this.an.bindingOfDecl(decl.id);
    return b && this.readOnlyRoot(b) ? b : undefined;
  }

  /** The object literals an array expression may hold as elements (null: not traceable). */
  private elementsOf(e: N): Set<N> | null {
    if (e.type !== "Identifier") return null;
    const b = this.an.refBinding.get(e);
    if (!b || !this.readOnlyRoot(b)) return null;
    const init = b.inits[0]!;
    if (init.type !== "ArrayExpression") return null;
    const out = new Set<N>();
    for (const el of init.elements as (N | null)[]) {
      if (!el || el.type !== "ObjectExpression") return null;
      out.add(el);
    }
    return out;
  }

  /** The object literals an expression may evaluate to (null: not traceable to a rule table). */
  private recordsOf(e: N, seen = new Set<unknown>(), depth = 0): Set<N> | null {
    if (depth > 20 || seen.has(e)) return new Set();
    seen.add(e);
    const union = (parts: (Set<N> | null)[]): Set<N> | null => {
      const out = new Set<N>();
      for (const p of parts) {
        if (!p) return null;
        for (const x of p) out.add(x);
      }
      return out;
    };
    switch (e.type) {
      case "Literal":
        return e.value === null && !e.regex ? new Set() : null;
      case "ObjectExpression":
        return this.rootOf(e) ? new Set([e]) : null;
      case "ConditionalExpression":
        return union([this.recordsOf(e.consequent, seen, depth + 1), this.recordsOf(e.alternate, seen, depth + 1)]);
      case "LogicalExpression":
        return union([this.recordsOf(e.left, seen, depth + 1), this.recordsOf(e.right, seen, depth + 1)]);
      case "MemberExpression": {
        if (!e.computed || !this.an.isNumeric(e.property)) return null;
        return this.elementsOf(e.object);
      }
      case "CallExpression": {
        if (e.callee.type !== "Identifier") return null;
        const b = this.an.refBinding.get(e.callee);
        const fn = b ? this.an.localFunction(b) : undefined;
        if (!fn) return null;
        return union(this.an.returnsOf(fn).map((r) => (r.argument ? this.recordsOf(r.argument, seen, depth + 1) : new Set<N>())));
      }
      case "Identifier": {
        const b = this.an.refBinding.get(e);
        if (!b || b.updates.length > 0) return null;
        if (b.kind === "var") {
          const defs = [...b.inits, ...b.assigns.map((a) => (a.op === "=" ? a.value : undefined))];
          if (defs.some((d) => d === undefined)) return null;
          return union(defs.map((d) => this.recordsOf(d as N, seen, depth + 1)));
        }
        if (b.kind === "param" && b.param) {
          const fn = b.param.fn;
          const call = this.an.parent.get(fn);
          if (b.param.index === 0 && fn.type === "FunctionExpression" && call?.type === "CallExpression" && call.arguments[0] === fn && call.callee.type === "MemberExpression" && !call.callee.computed && call.callee.property.name === "forEach") {
            return this.elementsOf(call.callee.object);
          }
          const owner = this.an.ownerOfFunction(fn);
          if (owner && this.an.localFunction(owner) === fn && !owner.escapes && owner.calls.length > 0 && b.assigns.length === 0) {
            return union(owner.calls.map((c) => ((c.arguments as N[])[b.param!.index] ? this.recordsOf((c.arguments as N[])[b.param!.index]!, seen, depth + 1) : new Set<N>())));
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** The literal string values `<record>.<prop>` can take, or null when the record is not a read-only rule-table entry or a value is not a literal string. */
  private tableStrings(e: N, prop: (typeof KEYS_TRACKED)[number]): string[] | null {
    if (e.type !== "MemberExpression" || e.computed || e.property.name !== prop) return null;
    const recs = this.recordsOf(e.object);
    if (!recs) return null;
    const out: string[] = [];
    for (const r of recs) {
      for (const p of r.properties as N[]) {
        const k = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
        if (k !== prop) continue;
        const v = this.an.fold(p.value);
        if (typeof v !== "string") return null;
        out.push(v);
        if (prop === "event") this.reachedRecords.add(r);
      }
    }
    return out;
  }

  /** The strings an expression can be, when statically known: a folded literal, `rule.<prop>` of a rule table, or a conditional of those. */
  strings(e: N, prop: (typeof KEYS_TRACKED)[number]): { values: string[]; via: "literal" | "table" } | null {
    const v = this.an.fold(e);
    if (typeof v === "string") return { values: [v], via: "literal" };
    if (e.type === "ConditionalExpression") {
      const a = this.strings(e.consequent, prop);
      const b = this.strings(e.alternate, prop);
      return a && b ? { values: [...a.values, ...b.values], via: a.via === "table" || b.via === "table" ? "table" : "literal" } : null;
    }
    const t = this.tableStrings(e, prop);
    return t ? { values: t, via: "table" } : null;
  }

  /** Selector argument of querySelector / querySelectorAll / closest / matches: a constant string or a rule-table `selector`. */
  selectorStrings(e: N): string[] | null {
    const s = this.strings(e, "selector");
    if (!s) return null;
    this.use(s.via === "table" ? "selector-table" : "selector-literal");
    return s.values;
  }

  // ---------- name-bearing helpers

  analyze(trackFn: N | undefined, add: AddFinding): NameFlowResult {
    const an = this.an;
    const names = new Set<string>();
    const nameBearing = new Map<N, Set<number>>();
    if (trackFn) nameBearing.set(trackFn, new Set([0]));

    const calls: { call: N; fn: N }[] = [];
    for (const n of an.nodes) {
      if (n.type !== "CallExpression" || n.callee.type !== "Identifier") continue;
      const b = an.refBinding.get(n.callee);
      const fn = b ? an.localFunction(b) : undefined;
      if (fn) calls.push({ call: n, fn });
    }

    // A parameter that is passed as a name-bearing argument becomes name-bearing itself (fixpoint over the call graph).
    let changed = true;
    while (changed) {
      changed = false;
      for (const { call, fn } of calls) {
        for (const i of nameBearing.get(fn) ?? []) {
          const arg = (call.arguments as N[])[i];
          const pb = arg?.type === "Identifier" ? an.refBinding.get(arg) : undefined;
          if (pb?.kind === "param" && pb.param) {
            const set = nameBearing.get(pb.param.fn) ?? nameBearing.set(pb.param.fn, new Set()).get(pb.param.fn)!;
            if (!set.has(pb.param.index)) {
              set.add(pb.param.index);
              changed = true;
            }
          }
        }
      }
    }

    const paramIsNameBearing = (b: Binding | undefined): boolean => !!b && b.kind === "param" && !!b.param && !!nameBearing.get(b.param.fn)?.has(b.param.index);

    for (const [fn, indices] of nameBearing) {
      const owner = an.ownerOfFunction(fn);
      const label = fn.id?.name ?? owner?.name ?? "<function>";
      if (owner?.escapes) add("event-name-static", `${label}() carries event names but is used as a value (passed, stored or aliased), so its callers cannot be checked. Call it directly`, fn);
      for (const i of indices) {
        const pid = (fn.params as N[])[i];
        const pb = pid ? an.bindingOfDecl(pid) : undefined;
        if (pb && (pb.assigns.length > 0 || pb.updates.length > 0)) add("event-name-static", `The event-name parameter "${pb.name}" of ${label}() is reassigned; it must be passed through unchanged`, pid);
      }
    }

    const reachNames = (arg: N, calleeName: string, call: N) => {
      if (paramIsNameBearing(arg.type === "Identifier" ? an.refBinding.get(arg) : undefined)) {
        this.use("event-name-passthrough");
        return;
      }
      if (arg.type === "ConditionalExpression") {
        reachNames(arg.consequent, calleeName, call);
        reachNames(arg.alternate, calleeName, call);
        return;
      }
      const s = this.strings(arg, "event");
      if (!s) {
        add(
          "event-name-static",
          `Event name argument \`${this.text(arg)}\` of ${calleeName}() is not statically known. It must be a string literal (or a concatenation of literals), a rule-table field \`rule.event\` where the table is a var holding object literals with literal \`event:\` values, or a pass-through of a name parameter. Page text, form values, attributes, location, storage reads and loop variables may not become an event name`,
          arg,
        );
        return;
      }
      this.use(s.via === "table" ? "event-name-table" : "event-name-literal");
      for (const v of s.values) names.add(v);
    };

    for (const { call, fn } of calls) {
      const bearing = nameBearing.get(fn);
      if (!bearing) continue;
      const calleeName = call.callee.name as string;
      for (const i of bearing) {
        const arg = (call.arguments as N[])[i];
        if (!arg) add("event-name-static", `${calleeName}() is called without its event-name argument`, call);
        else reachNames(arg, calleeName, call);
      }
    }

    // Every `event:` in a rule table must itself be a literal string, reached or not.
    const unreached: string[] = [];
    for (const n of an.nodes) {
      if (n.type !== "Property") continue;
      const k = n.key.type === "Identifier" ? n.key.name : String(n.key.value);
      if (k !== "event") continue;
      const v = an.fold(n.value);
      if (typeof v !== "string") {
        add("event-name-static", `\`event:\` in a rule table must be a string literal, found \`${this.text(n.value)}\``, n);
        continue;
      }
      const record = an.parent.get(n);
      if (record && !this.reachedRecords.has(record)) unreached.push(v);
    }

    // `.event` / `.selector` of any record may not be assigned: the table must stay what it was written as.
    for (const n of an.nodes) {
      const target = n.type === "AssignmentExpression" ? n.left : n.type === "UpdateExpression" ? n.argument : undefined;
      if (target?.type === "MemberExpression" && !target.computed && KEYS_TRACKED.includes(target.property.name)) {
        add("event-name-static", `Assigning to ".${target.property.name}" is refused: rule tables are read-only so event names and selectors stay literal`, n);
      }
    }

    for (const name of names) {
      if (name.length === 0) add("event-name-static", "An empty event name is not allowed");
      if (name.length > MAX_EVENT_NAME_LENGTH) add("event-name-limit", `Event name "${name.slice(0, 30)}..." is ${name.length} characters; the limit is ${MAX_EVENT_NAME_LENGTH}`);
    }
    if (names.size > MAX_EVENT_NAMES) add("event-name-limit", `The script can emit ${names.size} distinct event names; the limit is ${MAX_EVENT_NAMES}`);

    return { names, unreached };
  }
}
