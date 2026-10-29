// Closed-world (allowlist) rules for generated tracking scripts, parsed with acorn at ecmaVersion 5.
//
// MODEL. A script may use ONLY the syntax, globals, members and call targets listed in ALLOWLIST below.
// The list is derived from Kenn's skill (context pack v2), the three v2 samples, both deliverables and the
// canned fake-agent scripts, plus a short list of obviously equivalent read-only members that the skill's
// own advice needs (querySelector, getElementById, document.body, getBoundingClientRect, a few pure string
// and Math helpers). Anything else is an error that names the construct and how to request it be added.
// There is no deny list to keep complete: a new bypass has to be an allowlisted construct to get through.
//
// Round 4 adds: statically known event names and selectors (name-flow.ts), heuristic resource-bomb rules (resource-rules.ts:
// bounded for only, no recursion, nested-quantifier regexes, self-growing strings) and sensitive-selector text rules
// (selector-rules.ts).
//
// IMPORTANT: this is STILL NOT A SECURITY BOUNDARY. It is a machine-checked contract plus a strong filter.
// Classes it does not model are listed in PLAN.md and README.md (behaviors of allowed APIs that nobody has examined,
// the heuristic-only resource rules, a script choosing among its own literal names based on page data, the Heatmap
// runtime itself). The jsdom poison in
// test/klaviyo/harness.ts cannot see string-timer eval, network or navigation (jsdom does not run them).
// The real boundary for untrusted generated code is the isolated per-job container (Deferred D6).
import { parse, type Node } from "acorn";
import { NameFlow } from "./name-flow.ts";
import { checkDataFlow } from "./growth-flow.ts";
import { checkListeners } from "./listener-rules.ts";
import { checkArrayLikeAndJoin, checkGrowth, checkIndexes, checkLoops, checkRecursion, inLoop, regexHasNestedQuantifier, regexProblem, walk } from "./resource-rules.ts";
import { selectorProblem, triggerSelectorProblem } from "./selector-rules.ts";

export interface RuleFinding {
  rule: string;
  message: string;
  severity: "error" | "warn";
  line?: number;
}

export interface TransportSpec {
  /** The only global member a script may call to hand events to Heatmap. */
  description: string;
  global: string;
  member: string;
  destination: string;
}

export interface ScriptRuleOptions {
  transport: TransportSpec;
  siteSlug: string;
}

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes are walked structurally
type N = Node & Record<string, any>;

// ---------------------------------------------------------------- the allowlist

/**
 * Every entry is addressed as "<category>:<name>". The test `every allowlist entry is exercised` requires each
 * entry to be used by at least one valid script or unit-test script, so the list cannot silently grow.
 */
export const ALLOWLIST: Record<string, string[]> = {
  // Syntax: the only AST node types a script may contain.
  node: [
    "Program", "ExpressionStatement", "BlockStatement", "EmptyStatement", "VariableDeclaration", "VariableDeclarator",
    "FunctionDeclaration", "FunctionExpression", "ReturnStatement", "IfStatement", "ForStatement",
    "BreakStatement", "ContinueStatement", "TryStatement", "CatchClause", "Identifier", "Literal", "ArrayExpression",
    "ObjectExpression", "Property", "MemberExpression", "CallExpression", "NewExpression", "AssignmentExpression",
    "UpdateExpression", "UnaryExpression", "BinaryExpression", "LogicalExpression", "ConditionalExpression",
  ],
  unary: ["!", "-", "+", "typeof"],
  binary: ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%"],
  logical: ["&&", "||"],
  assign: ["=", "+=", "-="],
  update: ["++", "--"],
  // Globals a script may name (free identifiers). Each has a fixed usage form, below.
  global: ["window", "document", "location", "sessionStorage", "console", "JSON", "Math", "Array", "URL"],
  // Members of those globals.
  "window.read": ["scrollY", "innerHeight"],
  "window.call": ["addEventListener", "matchMedia", "getComputedStyle"],
  "window.object": ["location"],
  "window.transport": ["_fireCustomEvent"],
  "document.read": ["documentElement", "readyState", "body"],
  "document.call": ["addEventListener", "querySelector", "querySelectorAll", "getElementById"],
  "location.read": ["pathname", "origin", "search", "href"],
  "sessionStorage.call": ["getItem", "setItem", "removeItem"],
  "console.call": ["log"],
  "JSON.call": ["parse", "stringify"],
  "Math.call": ["abs", "floor", "round"],
  // Members of any other value (an element, an event, a string, an array, a plain object). Reads only.
  "prop.read": [
    "target", "touches", "changedTouches", "clientX", "clientY", "nodeType", "nodeName", "tagName", "parentElement", "id", "name",
    "text", "textContent", "innerText", "disabled", "options", "selectedIndex", "value", "classList", "length", "scrollHeight",
    "display", "visibility", "width", "height", "bottom", "left", "right", "matches", "pathname", "origin",
  ],
  // Methods callable on any value. Read-only DOM queries and pure string/array helpers.
  "method.any": [
    "closest", "matches", "contains", "getAttribute", "querySelector", "querySelectorAll", "getBoundingClientRect",
    "forEach", "filter", "indexOf", "slice", "concat", "join", "split", "trim", "replace", "toLowerCase", "toUpperCase",
    "charAt", "substring", "test",
  ],
  // Mutating methods: only on a variable that provably holds a plain local array/object.
  "method.plain": ["push"],
  // Special forms.
  special: [
    "Array.prototype.slice.call", "new URL", "local-plain-assignment", "computed-numeric-index", "computed-plain-key",
    "transport-call", "iife", "bounded-for", "event-name-literal", "event-name-table", "event-name-passthrough", "selector-literal", "selector-table",
  ],
};

export function allowlistEntries(): string[] {
  return Object.entries(ALLOWLIST).flatMap(([category, names]) => names.map((n) => `${category}:${n}`));
}

const set = (key: string) => new Set(ALLOWLIST[key] ?? []);
const NODE_TYPES = set("node");
const UNARY = set("unary");
const BINARY = set("binary");
const LOGICAL = set("logical");
const ASSIGN = set("assign");
const UPDATE = set("update");
const GLOBAL_OBJECTS = set("global");
const PROP_READS = set("prop.read");
const METHOD_ANY = set("method.any");
const METHOD_PLAIN = set("method.plain");
const MEMBER_TABLES: Record<string, { reads: Set<string>; calls: Set<string> }> = {
  window: { reads: set("window.read"), calls: set("window.call") },
  document: { reads: set("document.read"), calls: set("document.call") },
  location: { reads: set("location.read"), calls: new Set() },
  sessionStorage: { reads: new Set(), calls: set("sessionStorage.call") },
  console: { reads: new Set(), calls: set("console.call") },
  JSON: { reads: new Set(), calls: set("JSON.call") },
  Math: { reads: new Set(), calls: set("Math.call") },
};

/** Names a script may not declare: they are, or would hide, a global. (Declared names also may not contain window/document/globalThis.) */
const RESERVED_NAMES = new Set([
  ...GLOBAL_OBJECTS, "String", "Number", "parseInt", "isNaN", "self", "top", "parent", "frames", "opener", "globalThis", "eval", "undefined", "NaN", "Infinity",
  "arguments", "Object", "Function", "Date", "RegExp", "Error", "navigator", "history", "screen", "performance", "localStorage", "fetch",
  "setTimeout", "setInterval", "XMLHttpRequest", "Image", "Audio", "klaviyo", "_learnq",
]);

const REQUEST =
  "To request that it be added: put it in ALLOWLIST (script-rules.ts) together with a valid-script test and a probe for the bypass it could open, and have it reviewed.";

/** Names that are known sinks or ways around the allowlist. They get a specific rule id and message; unknown names get the generic one. */
const HINT_GROUPS: [string, string, string[]][] = [
  [
    "no-network",
    "can send data off the page; the only outbound path is the Heatmap hand-off",
    ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts", "Image", "Audio", "Option", "open", "postMessage", "submit", "click", "ping", "navigator", "BroadcastChannel", "MessageChannel", "requestSubmit", "dispatchEvent"],
  ],
  ["no-navigation", "navigates or reloads the page, which can carry data in the URL", ["assign", "reload", "history", "pushState", "replaceState", "go", "navigate"]],
  [
    "no-dynamic-code",
    "evaluates or builds code, or reaches the Function constructor",
    ["eval", "Function", "unescape", "escape", "atob", "btoa", "Reflect", "Proxy", "fromCharCode", "fromCodePoint", "constructor", "__proto__", "prototype", "callee", "caller", "execScript", "bind", "apply", "call"],
  ],
  [
    "no-timers",
    "timers are not permitted: a string argument evaluates code at run time, and no sample or deliverable needs a timer",
    ["setTimeout", "setInterval", "setImmediate", "requestAnimationFrame", "requestIdleCallback", "clearTimeout", "clearInterval"],
  ],
  ["no-persistent-storage", "persistent storage is not permitted; use sessionStorage with a site prefix", ["localStorage", "indexedDB", "openDatabase", "cookie", "caches", "cookieStore"]],
  [
    "no-script-injection",
    "writes to the page or builds elements; an element with a URL attribute is an outbound request",
    [
      "createElement", "createElementNS", "createRange", "createContextualFragment", "createTextNode", "appendChild", "insertBefore", "append", "prepend",
      "replaceWith", "replaceChild", "removeChild", "insertAdjacentHTML", "insertAdjacentElement", "insertAdjacentText", "innerHTML", "outerHTML",
      "write", "writeln", "srcdoc", "setAttribute", "setAttributeNS", "setAttributeNode", "style", "cssText", "src", "srcset", "action", "formAction",
      "DOMParser", "adoptNode", "importNode", "cloneNode", "attachShadow", "execCommand",
    ],
  ],
  [
    "no-global-alias",
    "is, or can lead to, the window object or another global",
    [
      "self", "top", "parent", "globalThis", "frames", "opener", "defaultView", "ownerDocument", "contentWindow", "contentDocument", "parentWindow",
      "view", "composedPath", "getRootNode", "Object", "getOwnPropertyNames", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors",
      "getPrototypeOf", "setPrototypeOf", "defineProperty", "defineProperties", "__defineGetter__", "__defineSetter__", "__lookupGetter__",
      "__lookupSetter__", "keys", "values", "entries", "currentTarget", "srcElement",
    ],
  ],
];
const HINTS = new Map<string, [string, string]>(HINT_GROUPS.flatMap(([rule, why, names]) => names.map((n): [string, [string, string]] => [n, [rule, why]])));
const HINT_DETAIL: Record<string, string> = {
  currentTarget: 'read event.target instead; event.currentTarget/srcElement can be the window or document object',
  srcElement: 'read event.target instead; event.currentTarget/srcElement can be the window or document object',
};
const hintFor = (name: string): [string, string] | undefined => HINTS.get(name) ?? (/^on[a-z]+$/.test(name) ? ["no-script-injection", "event-handler properties run code from a string or assign handlers"] : undefined);

const DANGEROUS_KEYS = /^(constructor|prototype|__\w*__|caller|callee|arguments)$/;
const FORBIDDEN_FRAGMENT_SOURCES = ["klaviyo", "_learnq"];
const PRIVATE_FIELD = /type\s*=\s*["']?(password|email|tel)\b|\b(cc-number|card[-_]?number|cvv|cvc|ssn|password)\b/i;
/** URL schemes that run code or smuggle data; refused in any string literal. */
const SCRIPT_URL = /^\s*(?:javascript|vbscript|data|blob|file)\s*:/i;
/** Member reads and calls that return page-controlled text. */
const PAGE_READS = new Set(["value", "textContent", "innerText", "text", "id", "name", "href", "search", "pathname", "origin", "target", "nodeName", "tagName", "options", "selectedIndex"]);
const PAGE_CALLS = new Set(["getAttribute", "getItem", "parse", "querySelector", "querySelectorAll", "getElementById", "closest"]);
const ENCODED_STRING = /&#|&[a-z]+;|%[0-9a-f]{2}/i;
const ESCAPE_IN_SOURCE = /\\(x[0-9a-f]{2}|u[0-9a-f]{4}|u\{|[0-7]{1,3})/i;
const TAG = /\[heatmap>klaviyo\]/gi;
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9_]/g, "");
const reverse = (s: string) => s.split("").reverse().join("");

/** True when the text is, contains, reverses to, or is a prefix/suffix fragment of a forbidden global name. */
export function namesForbiddenGlobal(text: string): boolean {
  const n = normalize(text.replace(TAG, ""));
  if (!n) return false;
  for (const v of [n, reverse(n)]) {
    if (v.includes("klaviyo") || v.includes("learnq")) return true;
    if (v.length >= 4 && "klaviyo".includes(v)) return true; // any 4+ char piece: lavi, aviy, viyo ...
    if (v.length >= 3) for (const name of FORBIDDEN_FRAGMENT_SOURCES) if (name.startsWith(v) || name.endsWith(v)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- scopes, bindings, constant folding

type Val = string | number | boolean | Val[] | undefined;
const toStr = (v: Val): string => (Array.isArray(v) ? v.map((x) => (x === undefined ? "" : toStr(x))).join(",") : String(v));

export interface Binding {
  name: string;
  kind: "var" | "param" | "function" | "fname" | "catch";
  decls: N[];
  inits: N[];
  assigns: { op: string; value: N }[];
  updates: N[];
  calls: N[];
  /** The function is referenced other than as a direct callee (passed or stored). */
  escapes: boolean;
  fn?: N;
  param?: { fn: N; index: number };
}
interface Scope {
  node: N;
  parent?: Scope;
  bindings: Map<string, Binding>;
}

const isScopeNode = (n: N) => n.type === "Program" || n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "CatchClause";
const isFunction = (n: N) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression";

const PLAIN_RESULT_METHODS = new Set([
  "parse", "stringify", "slice", "filter", "concat", "split", "join", "replace", "trim", "toLowerCase", "toUpperCase", "charAt", "substring", "indexOf",
  "test", "getAttribute", "getItem", "contains", "matches", "abs", "floor", "round",
]);
const NUMERIC_RESULT_METHODS = new Set(["indexOf", "abs", "floor", "round"]);
const NUMERIC_MEMBERS = new Set(["length", "selectedIndex"]);

export class Analysis {
  readonly program: N;
  readonly nodes: N[] = [];
  readonly parent = new Map<N, N>();
  private readonly scopes = new Map<N, Scope>();
  /** Identifier reference -> binding. Absent: the identifier is free (a global). */
  readonly refBinding = new Map<N, Binding>();
  readonly declIds = new Set<N>();
  private readonly declBinding = new Map<N, Binding>();
  private readonly fnBinding = new Map<N, Binding>();
  private readonly returns = new Map<N, N[]>();
  private readonly plainMemo = new Map<Binding, boolean>();

  constructor(program: N) {
    this.program = program;
    this.index(program, undefined);
    for (const n of this.nodes) if (isScopeNode(n)) this.scopes.set(n, { node: n, ...(n === program ? {} : { parent: this.scopes.get(this.scopeNodeOf(n))! }), bindings: new Map() });
    for (const n of this.nodes) this.declare(n);
    for (const n of this.nodes) this.resolve(n);
    for (const n of this.nodes) this.record(n);
  }

  private index(node: N, parent: N | undefined) {
    this.nodes.push(node);
    if (parent) this.parent.set(node, parent);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) if (c && typeof c.type === "string") this.index(c, node);
      if (v && typeof v === "object" && typeof v.type === "string") this.index(v, node);
    }
  }

  /** Nearest strict ancestor that opens a scope (function, catch clause, program). */
  scopeNodeOf(node: N): N {
    let p = this.parent.get(node);
    while (p && !isScopeNode(p)) p = this.parent.get(p);
    return p ?? this.program;
  }
  /** Nearest strict ancestor function or program (var declarations hoist here). */
  private varScopeNodeOf(node: N): N {
    let p = this.parent.get(node);
    while (p && !(isFunction(p) || p.type === "Program")) p = this.parent.get(p);
    return p ?? this.program;
  }
  functionOf(node: N): N {
    return this.varScopeNodeOf(node);
  }

  private bind(scope: Scope, id: N, kind: Binding["kind"]): Binding {
    let b = scope.bindings.get(id.name);
    if (!b) {
      b = { name: id.name, kind, decls: [], inits: [], assigns: [], updates: [], calls: [], escapes: false };
      scope.bindings.set(id.name, b);
    }
    b.decls.push(id);
    this.declIds.add(id);
    this.declBinding.set(id, b);
    return b;
  }

  private declare(n: N) {
    if (n.type === "FunctionDeclaration") {
      const b = this.bind(this.scopes.get(this.varScopeNodeOf(n))!, n.id, "function");
      b.fn = n;
      this.fnBinding.set(n, b);
    }
    if (isFunction(n)) {
      const own = this.scopes.get(n)!;
      if (n.type === "FunctionExpression" && n.id) this.bind(own, n.id, "fname");
      (n.params as N[]).forEach((p, index) => {
        const b = this.bind(own, p, "param");
        b.param = { fn: n, index };
      });
    }
    if (n.type === "CatchClause") this.bind(this.scopes.get(n)!, n.param, "catch");
    if (n.type === "VariableDeclarator") {
      const b = this.bind(this.scopes.get(this.varScopeNodeOf(n))!, n.id, "var");
      if (n.init) {
        b.inits.push(n.init);
        if (n.init.type === "FunctionExpression") this.fnBinding.set(n.init, b);
      }
    }
    if (n.type === "ReturnStatement") {
      const fn = this.functionOf(n);
      (this.returns.get(fn) ?? this.returns.set(fn, []).get(fn)!).push(n);
    }
  }

  private lookup(scope: Scope | undefined, name: string): Binding | undefined {
    for (let s = scope; s; s = s.parent) {
      const b = s.bindings.get(name);
      if (b) return b;
    }
    return undefined;
  }

  private resolve(n: N) {
    if (n.type !== "Identifier" || this.declIds.has(n)) return;
    const p = this.parent.get(n);
    if (p && ((p.type === "MemberExpression" && p.property === n && !p.computed) || (p.type === "Property" && p.key === n))) return;
    const b = this.lookup(this.scopes.get(this.scopeNodeOf(n)), n.name);
    if (!b) return;
    this.refBinding.set(n, b);
    if (p?.type === "CallExpression" && p.callee === n) b.calls.push(p);
    else if (!(p?.type === "AssignmentExpression" && p.left === n) && !(p?.type === "UpdateExpression")) b.escapes = true;
  }

  private record(n: N) {
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier") {
      const b = this.refBinding.get(n.left);
      if (b) b.assigns.push({ op: n.operator, value: n.right });
    }
    if (n.type === "UpdateExpression" && n.argument.type === "Identifier") {
      const b = this.refBinding.get(n.argument);
      if (b) b.updates.push(n);
    }
  }

  ownerOfFunction(fn: N): Binding | undefined {
    return this.fnBinding.get(fn);
  }
  /** The binding a declaring identifier (var, parameter, function name, catch parameter) creates. */
  bindingOfDecl(id: N): Binding | undefined {
    return this.declBinding.get(id);
  }
  /** Return statements of a function. */
  returnsOf(fn: N): N[] {
    return this.returns.get(fn) ?? [];
  }

  isFree(n: N): boolean {
    return n.type === "Identifier" && !this.refBinding.has(n);
  }
  isFreeNamed(n: N | undefined, name: string): boolean {
    return !!n && n.type === "Identifier" && n.name === name && this.isFree(n);
  }

  /** A function declared in this script (declaration, or a var assigned a function expression once and never reassigned). */
  localFunction(b: Binding | undefined): N | undefined {
    if (!b || b.assigns.length > 0 || b.updates.length > 0 || b.decls.length !== 1) return undefined;
    if (b.kind === "function") return b.fn;
    if (b.kind === "var" && b.inits.length === 1 && b.inits[0]!.type === "FunctionExpression") return b.inits[0];
    return undefined;
  }

  // -------- constants: a var declared once with a foldable init and never reassigned
  fold(e: N | undefined, depth = 0): Val {
    if (!e || depth > 40) return undefined;
    switch (e.type) {
      case "Literal":
        return e.regex ? undefined : typeof e.value === "string" || typeof e.value === "number" || typeof e.value === "boolean" ? e.value : undefined;
      case "Identifier": {
        const b = this.refBinding.get(e);
        if (!b || b.kind !== "var" || b.decls.length !== 1 || b.inits.length !== 1 || b.assigns.length > 0 || b.updates.length > 0) return undefined;
        const v = this.fold(b.inits[0], depth + 1);
        // An array "constant" that is pushed to, indexed-assigned or handed to another function is not constant.
        if (Array.isArray(v) && !this.arrayIsReadOnly(b)) return undefined;
        return v;
      }
      case "BinaryExpression": {
        if (e.operator !== "+") return undefined;
        const a = this.fold(e.left, depth + 1);
        const b = this.fold(e.right, depth + 1);
        if (a === undefined || b === undefined) return undefined;
        if (typeof a === "number" && typeof b === "number") return a + b;
        return toStr(a) + toStr(b);
      }
      case "ArrayExpression": {
        const out: Val[] = [];
        for (const el of e.elements as (N | null)[]) {
          const v = el ? this.fold(el, depth + 1) : "";
          if (v === undefined) return undefined;
          out.push(v);
        }
        return out;
      }
      case "CallExpression":
        return this.foldCall(e, depth);
      default:
        return undefined;
    }
  }

  /** Every reference reads the array: arr.length, arr[<number>], arr.join/concat/slice/indexOf(...), or arr as an argument of x.concat(...). */
  private arrayIsReadOnly(b: Binding): boolean {
    for (const [id, bound] of this.refBinding) {
      if (bound !== b) continue;
      const p = this.parent.get(id);
      if (p?.type === "CallExpression" && p.callee.type === "MemberExpression" && !p.callee.computed && p.callee.property.name === "concat" && p.arguments.includes(id)) continue;
      if (p?.type !== "MemberExpression" || p.object !== id) return false;
      const pp = this.parent.get(p);
      const written = (pp?.type === "AssignmentExpression" && pp.left === p) || pp?.type === "UpdateExpression";
      const called = pp?.type === "CallExpression" && pp.callee === p;
      if (written) return false;
      if (p.computed) {
        if (called || !this.isNumeric(p.property)) return false;
      } else if (called) {
        if (!["join", "concat", "slice", "indexOf"].includes(p.property.name)) return false;
      } else if (p.property.name !== "length") return false;
    }
    return true;
  }

  private foldCall(e: N, depth: number): Val {
    const args = (e.arguments as N[]).map((a) => this.fold(a, depth + 1));
    const c = e.callee as N;
    if (c.type === "Identifier") {
      if (!this.isFree(c) || args.some((a) => a === undefined)) return undefined;
      return c.name === "String" ? toStr(args[0]) : undefined;
    }
    if (c.type !== "MemberExpression" || c.computed || c.property.type !== "Identifier") return undefined;
    const obj = this.fold(c.object, depth + 1);
    if (obj === undefined || args.some((a) => a === undefined)) return undefined;
    const m = c.property.name as string;
    const a0 = args[0];
    if (Array.isArray(obj)) {
      if (m === "join") return obj.map((x) => (x === undefined ? "" : toStr(x))).join(a0 === undefined ? "," : toStr(a0));
      if (m === "concat") return obj.concat(...args.map((a) => (Array.isArray(a) ? a : [a])));
      if (m === "slice") return obj.slice(Number(a0 ?? 0), args[1] === undefined ? undefined : Number(args[1]));
      return undefined;
    }
    const s = toStr(obj);
    switch (m) {
      case "split":
        return s.split(toStr(a0));
      case "toLowerCase":
        return s.toLowerCase();
      case "toUpperCase":
        return s.toUpperCase();
      case "charAt":
        return s.charAt(Number(a0 ?? 0));
      case "slice":
        return s.slice(Number(a0 ?? 0), args[1] === undefined ? undefined : Number(args[1]));
      case "substring":
        return s.substring(Number(a0 ?? 0), args[1] === undefined ? undefined : Number(args[1]));
      case "concat":
        return s.concat(...args.map(toStr));
      case "trim":
        return s.trim();
      case "replace":
        return typeof a0 === "string" && typeof args[1] === "string" ? s.replace(a0, () => args[1] as string) : undefined;
      default:
        return undefined;
    }
  }

  // -------- numeric expressions (safe computed-access keys)
  isNumeric(e: N, depth = 0): boolean {
    if (depth > 20) return false;
    switch (e.type) {
      case "Literal":
        return typeof e.value === "number";
      case "UpdateExpression":
        return true;
      case "UnaryExpression":
        return e.operator === "+" || e.operator === "-";
      case "BinaryExpression":
        if (["-", "*", "/", "%"].includes(e.operator)) return true;
        return e.operator === "+" && this.isNumeric(e.left, depth + 1) && this.isNumeric(e.right, depth + 1);
      case "ConditionalExpression":
        return this.isNumeric(e.consequent, depth + 1) && this.isNumeric(e.alternate, depth + 1);
      case "MemberExpression":
        return !e.computed && NUMERIC_MEMBERS.has(e.property.name);
      case "CallExpression": {
        const c = e.callee as N;
        if (c.type === "MemberExpression" && !c.computed) return NUMERIC_RESULT_METHODS.has(c.property.name) && (c.object.type !== "Identifier" || !this.isFree(c.object) || c.object.name === "Math");
        return false;
      }
      case "Identifier": {
        const b = this.refBinding.get(e);
        if (!b) return false;
        if (b.kind === "param") return this.isIndexParam(b);
        if (b.kind !== "var" || b.inits.length + b.assigns.length + b.updates.length === 0) return false;
        return (
          b.inits.every((i) => this.isNumeric(i, depth + 1)) &&
          b.assigns.every((a) => (a.op === "=" ? this.isNumeric(a.value, depth + 1) : a.op === "+=" ? this.isNumeric(a.value, depth + 1) : true))
        );
      }
      default:
        return false;
    }
  }

  /** The second parameter of a forEach/filter callback written inline is an array index. */
  private isIndexParam(b: Binding): boolean {
    if (!b.param || b.param.index !== 1) return false;
    const fn = b.param.fn;
    const call = this.parent.get(fn);
    return (
      fn.type === "FunctionExpression" &&
      !!call &&
      call.type === "CallExpression" &&
      call.arguments[0] === fn &&
      call.callee.type === "MemberExpression" &&
      !call.callee.computed &&
      ["forEach", "filter"].includes(call.callee.property.name)
    );
  }

  // -------- plain local data (object/array literals, JSON.parse results, results of pure helpers)
  isPlainBinding(b: Binding, seen = new Set<Binding>()): boolean {
    const memo = this.plainMemo.get(b);
    if (memo !== undefined) return memo;
    if (seen.has(b)) return true; // cycle: judged by its other definitions
    seen.add(b);
    let result: boolean;
    if (b.kind === "var") {
      result = b.inits.every((i) => this.isPlainExpr(i, seen)) && b.assigns.every((a) => (a.op === "=" ? this.isPlainExpr(a.value, seen) : true));
    } else if (b.kind === "param" && b.param) {
      const owner = this.fnBinding.get(b.param.fn);
      const fn = this.localFunction(owner);
      result = !!owner && fn === b.param.fn && !owner.escapes && owner.calls.length > 0 && owner.calls.every((c) => {
        const arg = (c.arguments as N[])[b.param!.index];
        return arg === undefined || this.isPlainExpr(arg, seen);
      });
    } else result = false;
    if (seen.size <= 1) this.plainMemo.set(b, result);
    return result;
  }

  isPlainExpr(e: N, seen = new Set<Binding>(), depth = 0): boolean {
    if (depth > 20) return false;
    switch (e.type) {
      case "Literal":
      case "ObjectExpression":
      case "ArrayExpression":
      case "UnaryExpression":
      case "BinaryExpression":
      case "UpdateExpression":
        return true;
      case "LogicalExpression":
        return this.isPlainExpr(e.left, seen, depth + 1) && this.isPlainExpr(e.right, seen, depth + 1);
      case "ConditionalExpression":
        return this.isPlainExpr(e.consequent, seen, depth + 1) && this.isPlainExpr(e.alternate, seen, depth + 1);
      case "AssignmentExpression":
        return e.operator === "=" && this.isPlainExpr(e.right, seen, depth + 1);
      case "Identifier": {
        const b = this.refBinding.get(e);
        return !!b && this.isPlainBinding(b, seen);
      }
      case "CallExpression": {
        const c = e.callee as N;
        if (c.type === "MemberExpression" && !c.computed) {
          if (isSliceCall(c, this)) return true;
          return PLAIN_RESULT_METHODS.has(c.property.name);
        }
        if (c.type === "Identifier") {
          const b = this.refBinding.get(c);
          if (!b) return false;
          const fn = this.localFunction(b);
          if (!fn) return false;
          const rets = this.returns.get(fn) ?? [];
          return rets.every((r) => !r.argument || this.isPlainExpr(r.argument, seen, depth + 1));
        }
        return false;
      }
      default:
        return false;
    }
  }
}

const isSliceCall = (c: N, an: Analysis): boolean => {
  // Array.prototype.slice.call
  const slice = c.object;
  if (c.computed || c.property.name !== "call" || slice?.type !== "MemberExpression" || slice.computed || slice.property.name !== "slice") return false;
  const proto = slice.object;
  if (proto?.type !== "MemberExpression" || proto.computed || proto.property.name !== "prototype") return false;
  return an.isFreeNamed(proto.object, "Array");
};

// ---------------------------------------------------------------- the rules

export interface ScriptAnalysis {
  parsed: boolean;
  findings: RuleFinding[];
  /** Every event name that can reach track(): literals, folded literal expressions, and rule-table `event:` values reached through `rule.event`. Exact. */
  eventNames: Set<string>;
  /** Allowlist entries ("<category>:<name>") this script used. */
  used: Set<string>;
}

export function parseScript(source: string): N {
  return parse(source, { ecmaVersion: 5, sourceType: "script", locations: true }) as unknown as N;
}

const isId = (n: N | undefined, name?: string): boolean => !!n && n.type === "Identifier" && (name === undefined || n.name === name);

export function analyzeScript(source: string, options: ScriptRuleOptions): ScriptAnalysis {
  const findings: RuleFinding[] = [];
  const eventNames = new Set<string>();
  const used = new Set<string>();
  const use = (category: string, name: string) => void used.add(`${category}:${name}`);
  const add = (rule: string, message: string, node?: N, severity: "error" | "warn" = "error") =>
    findings.push({ rule, message, severity, ...(node?.loc ? { line: node.loc.start.line } : {}) });

  // Text-level constructs that are comments or markup to a parser but meaningful elsewhere (HTML embedding, devtools fetches).
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  for (const m of source.matchAll(/<!--|(?:^|\n)[ \t]*-->|<\/script/gi)) {
    findings.push({ rule: "no-html-comment", severity: "error", message: `"${m[0].trim()}" is refused: HTML comment markers and </script are treated as comments or end the script when the file is pasted into a page, so what runs is not what was reviewed`, line: lineOf(m.index ?? 0) });
  }
  // Characters that change what a reviewer sees without changing what runs (bidi overrides, zero-width and other format
  // characters, line/paragraph separators, C0/C1 controls, variation selectors, blank-looking fillers such as U+3164 and U+2800), anywhere: code, strings, comments, regex literals.
  for (const m of source.matchAll(/[\p{Cf}\u2028\u2029\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u115F\u1160\u17B4\u17B5\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu)) {
    const cp = (m[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
    findings.push({ rule: "no-hidden-chars", severity: "error", message: `Invisible or control character U+${cp} is refused anywhere in script.js (code, strings and comments too): bidirectional overrides, zero-width and other format characters make the reviewed text differ from what runs. Leave it out`, line: lineOf(m.index ?? 0) });
    break;
  }
  if (/@cc_on|@if\s*\(|@set\s+@/i.test(source)) {
    findings.push({ rule: "no-conditional-comment", severity: "error", message: "JScript conditional comments (/*@cc_on, @if, @set) are refused: an old engine runs what other engines treat as a comment" });
  }
  for (const m of source.matchAll(/[#@]\s*source(?:Mapping)?URL\s*=/gi)) {
    findings.push({ rule: "no-source-map", severity: "error", message: "A sourceMappingURL / sourceURL comment is refused: browser devtools fetch the URL it names", line: lineOf(m.index ?? 0) });
  }

  let program: N;
  try {
    program = parseScript(source);
  } catch (e) {
    const err = e as { message: string; loc?: { line: number } };
    findings.push({ rule: "es5", severity: "error", message: `script.js does not parse as ES5: ${err.message}`, ...(err.loc ? { line: err.loc.line } : {}) });
    return { parsed: false, findings, eventNames, used };
  }
  const an = new Analysis(program);
  const t = options.transport;

  const transportCalls: N[] = [];
  const trackDecls: N[] = [];
  const listenerCalls: N[] = [];
  const tries: N[] = [];
  let sawReadyState = false;
  let sawLoadListener = false;
  const approvedDestinations = new Set<N>();
  /** Nodes of a special form (Array.prototype.slice.call) that are validated as a unit. */
  const approved = new Set<N>();

  const foldedText = (n: N): string | undefined => {
    const v = an.fold(n);
    return v === undefined ? undefined : toStr(v);
  };

  // Local property names: object-literal keys and names assigned on plain local objects.
  const localKeys = new Set<string>();
  for (const n of an.nodes) {
    if (n.type === "Property") {
      const k = n.key.type === "Identifier" ? (n.key.name as string) : String(n.key.value);
      if (!DANGEROUS_KEYS.test(k)) localKeys.add(k);
    }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && !n.left.computed && isPlainRoot(n.left.object)) {
      const k = n.left.property.name as string;
      if (!DANGEROUS_KEYS.test(k)) localKeys.add(k);
    }
  }

  function isPlainRoot(obj: N): boolean {
    if (obj.type !== "Identifier") return false;
    const b = an.refBinding.get(obj);
    return !!b && an.isPlainBinding(b);
  }

  const deny = (name: string, node: N, kind: "global" | "member", where = "") => {
    const hint = hintFor(name);
    if (hint) add(hint[0], `"${name}"${where} is forbidden: ${HINT_DETAIL[name] ?? hint[1]}. It is not on the closed-world allowlist. ${REQUEST}`, node);
    else {
      add(
        kind === "global" ? "allowlist-global" : "allowlist-member",
        `"${name}"${where} is not on the closed-world allowlist of ${kind === "global" ? "globals" : "members"}. ${REQUEST}`,
        node,
      );
    }
  };

  // ---- shape: exactly one IIFE
  const body = program.body as N[];
  const iife =
    body.length === 1 &&
    body[0]!.type === "ExpressionStatement" &&
    body[0]!.expression.type === "CallExpression" &&
    body[0]!.expression.callee.type === "FunctionExpression" &&
    body[0]!.expression.callee.params.length === 0 &&
    body[0]!.expression.arguments.length === 0;
  if (!iife) add("shape", "script.js must be a single IIFE: (function () { ... })();", body[0]);
  else use("special", "iife");

  const positionOf = (n: N) => {
    const p = an.parent.get(n);
    return {
      parent: p,
      isCallee: p?.type === "CallExpression" && p.callee === n,
      isAssignTarget: (p?.type === "AssignmentExpression" && p.left === n) || (p?.type === "UpdateExpression" && p.argument === n),
      isTypeofArg: p?.type === "UnaryExpression" && p.operator === "typeof",
    };
  };

  /** Computed access: arr[numeric] anywhere except on a global; obj[key] only on a plain local variable, and its result may not be dereferenced or called. */
  function checkComputed(n: N) {
    const obj = n.object as N;
    const key = n.property as N;
    const k = an.fold(key);
    if (typeof k === "string") {
      add("no-computed-access", `Computed access with the constant string key "${k.slice(0, 40)}" is refused; write it with dot notation so the member allowlist can see it`, n);
      return;
    }
    if (typeof k === "number" || an.isNumeric(key)) {
      use("special", "computed-numeric-index");
      return;
    }
    const p = an.parent.get(n);
    const dereferenced = (p?.type === "MemberExpression" && p.object === n) || (p?.type === "CallExpression" && p.callee === n) || (p?.type === "NewExpression" && p.callee === n);
    if (isPlainRoot(obj) && !dereferenced) {
      use("special", "computed-plain-key");
      return;
    }
    add(
      "no-computed-access",
      "Computed access with a non-constant key is allowed only as arr[<numeric index>] or obj[key] on a local variable that only holds plain data, and then its result may not be dereferenced or called (the key could name a hidden member at run time)",
      n,
    );
  }

  /** A member of one of the named globals (window, document, location, sessionStorage, console, JSON, Math). */
  function checkGlobalMember(n: N, g: string, name: string) {
    const table = MEMBER_TABLES[g];
    if (!table) {
      // A global with no member table (URL): it is only usable as `new URL(href, base)`, never as an object.
      if (positionOf(n).isAssignTarget) return; // reported by the assignment rule
      add("allowlist-member", `"${g}.${name}" is not allowed; ${g} may only be used as new URL(href, base) and has no members on the allowlist. ${REQUEST}`, n);
      return;
    }
    const pos = positionOf(n);
    if (g === "window" && name === "location") {
      const p = pos.parent;
      if (p?.type === "MemberExpression" && p.object === n && !p.computed && MEMBER_TABLES.location!.reads.has(p.property.name)) use("window.object", "location");
      else add("no-global-alias", `window.location may only be read as window.location.<${[...MEMBER_TABLES.location!.reads].join("|")}>; aliasing or assigning it navigates the page`, n);
      return;
    }
    if (g === "window" && name === t.member) {
      if (!(pos.isCallee || pos.isTypeofArg)) add("transport", `${t.global}.${t.member} may only be tested with typeof or called once from track()`, n);
      else use("window.transport", t.member);
      return;
    }
    if (table.reads.has(name) && !pos.isCallee && !pos.isAssignTarget) {
      use(`${g}.read`, name);
      if (g === "document" && name === "readyState") sawReadyState = true;
      return;
    }
    if (table.calls.has(name) && pos.isCallee) {
      use(`${g}.call`, name);
      return;
    }
    if (pos.isAssignTarget) return; // reported by the assignment rule
    if (table.reads.has(name) || table.calls.has(name)) {
      add("allowlist-member", `"${g}.${name}" must be ${table.calls.has(name) ? "called" : "read, not called"}`, n);
      return;
    }
    const allowed = [...table.reads, ...table.calls, ...(g === "window" ? ["location", t.member] : [])];
    if (hintFor(name)) deny(name, n, "member", ` (${g}.${name})`);
    else add("allowlist-member", `"${g}.${name}" is not on the closed-world allowlist; ${g} members allowed: ${allowed.join(", ") || "(none)"}. ${REQUEST}`, n);
  }

  function checkMember(n: N) {
    const obj = n.object as N;
    const pos = positionOf(n);
    const objIsGlobal = obj.type === "Identifier" && an.isFree(obj) && GLOBAL_OBJECTS.has(obj.name);

    if (n.computed) {
      if (objIsGlobal) {
        add("no-global-alias", `Computed access on ${obj.name} is forbidden`, n);
        return;
      }
      checkComputed(n);
      return;
    }
    const name = n.property.name as string;
    // WHY `.value` IS A WARN, NOT AN ERROR (round 4): the event name must be a literal or a rule-table field (name-flow.ts), and
    // track() sends only the name (properties are dropped), so a value read from a field can no longer reach anything outbound as
    // data. It can only steer local logic, e.g. "has the visitor picked a vehicle". It can still choose WHICH pre-written name fires
    // (a narrow covert channel: at most 50 names, each once per visit), which is why it stays a warning that a human must read.
    if (name === "value" && !pos.isAssignTarget) add("form-values", "Reads .value; only allowed if the request names the field. The value cannot become part of an event name (names must be static), but it can decide which fixed event fires", n, "warn");

    if (objIsGlobal) {
      if (obj.name === "Array") {
        add("allowlist-member", `Array may only be used in Array.prototype.slice.call(list); "Array.${name}" is not allowed. ${REQUEST}`, n);
        return;
      }
      checkGlobalMember(n, obj.name, name);
      return;
    }
    // window.location.<x> / location handled as globals; `<other>.location` is not.
    if (obj.type === "MemberExpression" && !obj.computed && obj.property.name === "location" && an.isFreeNamed(obj.object, "window")) {
      checkGlobalMember(n, "location", name);
      return;
    }
    if (name === "location") {
      add("no-global-alias", "Only window.location (read as window.location.pathname etc.) is permitted; location reached through another object is refused", n);
      return;
    }
    if (name === t.member) {
      add("transport", `"${t.member}" may only appear as ${t.global}.${t.member}`, n);
      return;
    }
    if (pos.isAssignTarget) return; // reported by the assignment rule
    if (METHOD_ANY.has(name) && pos.isCallee) {
      use("method.any", name);
      return;
    }
    if (METHOD_PLAIN.has(name) && pos.isCallee) {
      if (isPlainRoot(obj)) use("method.plain", name);
      else add("no-dom-assignment", `.${name}() mutates its receiver, so it is only allowed on a local variable that holds plain data (an array/object literal or JSON.parse result), not on "${source.slice(obj.start, obj.end).slice(0, 40)}"`, n);
      return;
    }
    if (pos.isCallee) {
      if (hintFor(name)) deny(name, n, "member", "()");
      else add("allowlist-call", `.${name}() is not on the closed-world allowlist of methods (${[...METHOD_ANY, ...METHOD_PLAIN].join(", ")}). ${REQUEST}`, n);
      return;
    }
    if (PROP_READS.has(name)) {
      use("prop.read", name);
      return;
    }
    if (METHOD_ANY.has(name)) {
      use("method.any", name); // read of a method as a value (e.g. `if (!node.closest) return;`); it can only be called through the allowlisted call forms
      return;
    }
    if (localKeys.has(name)) return; // read of a property the script itself puts on its own plain objects
    deny(name, n, "member");
  }

  function checkAssignTarget(target: N, node: N) {
    if (target.type === "Identifier") {
      const b = an.refBinding.get(target);
      if (!b) {
        if (target.name === "location") add("no-navigation", "Assigning to location navigates the page; forbidden", node);
        else add("no-dom-assignment", `Assigning to "${target.name}" would create or change a global; declare it with var`, node);
      } else if (b.kind === "function") add("no-dom-assignment", `Reassigning the function "${target.name}" is refused`, node);
      return;
    }
    if (target.type === "MemberExpression") {
      const obj = target.object as N;
      if (!target.computed && target.property.name === "length") {
        add("no-resource-bomb", `Assigning to ".length" is refused: a.length = 4294967295 allocates or truncates arrays at will (heuristic check)`, node);
        return;
      }
      if (isPlainRoot(obj) && (target.computed || !DANGEROUS_KEYS.test(target.property.name))) {
        use("special", "local-plain-assignment");
        return;
      }
      const name = target.computed ? undefined : (target.property.name as string);
      const text = source.slice(target.start, target.end).slice(0, 50);
      let rule = "no-dom-assignment";
      if (name && hintFor(name)) rule = hintFor(name)![0];
      else if (obj.type === "Identifier" && an.isFree(obj) && GLOBAL_OBJECTS.has(obj.name)) rule = obj.name === "location" ? "no-navigation" : "no-global-alias";
      else if (name === "href") rule = "no-navigation";
      add(
        rule,
        `Assigning to "${text}" is refused: only local plain-data bookkeeping (Id.prop = v or Id[key] = v where Id is a variable that only ever holds object/array literals, JSON.parse results or results of pure helpers) may be assigned. Writes to DOM/BOM objects can load URLs, run code or navigate. ${REQUEST}`,
        node,
      );
      return;
    }
    add("no-dom-assignment", "Unsupported assignment target", node);
  }

  const flow = new NameFlow(an, source, (u) => use("special", u));
  const isCallbackFunction = (a: N | undefined) => !!a && (a.type === "FunctionExpression" || (a.type === "Identifier" && !!an.localFunction(an.refBinding.get(a))));

  for (const n of an.nodes) {
    if (approved.has(n)) continue;

    // ---- syntax
    if (!NODE_TYPES.has(n.type)) {
      if (n.type === "ThisExpression") add("no-global-alias", '"this" is forbidden: in a plain function call it is the window object', n);
      else if (n.type === "WithStatement") add("no-global-alias", '"with" is forbidden', n);
      else if (n.type === "WhileStatement" || n.type === "DoWhileStatement") continue; // reported by checkLoops with the loop rule
      else if (n.type === "ForInStatement") add("no-for-in", "for..in is forbidden: it can enumerate the window object to find a Klaviyo global", n);
      else add("allowlist-node", `${n.type} is not on the closed-world allowlist of syntax. ${REQUEST}`, n);
      continue;
    }
    use("node", n.type);
    const parent = an.parent.get(n);

    switch (n.type) {
      case "Identifier": {
        const name = n.name as string;
        if (namesForbiddenGlobal(name)) add("no-direct-klaviyo", `Identifier or property "${name}" names a forbidden global; events go through ${t.description}`, n);
        if (DANGEROUS_KEYS.test(name) && name !== "arguments") add("no-dynamic-code", `"${name}" is forbidden: it leads to the Function constructor or the prototype chain`, n);
        if (PRIVATE_FIELD.test(name)) add("sensitive-fields", `Touches a sensitive field ("${name}"); never capture email, phone, payment or password fields`, n);
        const propertyPosition = (parent?.type === "MemberExpression" && parent.property === n && !parent.computed) || (parent?.type === "Property" && parent.key === n);
        if (name === t.member && !(parent?.type === "MemberExpression" && parent.property === n && isId(parent.object, t.global))) {
          add("transport", `"${t.member}" may only appear as ${t.global}.${t.member}`, n);
        }
        if (an.declIds.has(n)) {
          if (RESERVED_NAMES.has(name) || /window|document|globalthis/i.test(name)) {
            add("shadowed-global", `"${name}" may not be declared: it shadows a global, or its name contains window/document/globalThis and invites confusion with one`, n);
          }
        } else if (!propertyPosition && an.isFree(n)) {
          // a free identifier is a global: only the allowlisted forms
          if (GLOBAL_OBJECTS.has(name)) {
            const ok =
              name === "URL"
                ? parent?.type === "NewExpression" && parent.callee === n
                : name === "Array"
                  ? false
                  : parent?.type === "MemberExpression" && parent.object === n;
            if (ok) use("global", name);
            else if (name === "URL") add("no-new", `URL may only be used as new URL(href, base)`, n);
            else if (name === "Array") add("allowlist-global", `Array may only be used in Array.prototype.slice.call(list). ${REQUEST}`, n);
            else add("no-global-alias", `"${name}" may only be used as ${name}.<allowlisted member>; passing, aliasing, assigning or testing it is refused`, n);
          } else deny(name, n, "global");
        }
        break;
      }

      case "Literal": {
        if (n.regex) {
          const src = `${n.regex.pattern}`;
          if (namesForbiddenGlobal(src)) add("no-direct-klaviyo", `Regular expression /${src}/ names a forbidden global`, n);
          if (PRIVATE_FIELD.test(src)) add("sensitive-fields", `Regular expression touches a sensitive field (/${src}/)`, n);
          if (/(?:^|[^\\])(?:\\\\)*\\[1-9]/.test(src)) add("no-resource-bomb", `Regular expression /${src.slice(0, 40)}/ uses a backreference (\\1-\\9), which can take exponential time (heuristic check)`, n);
          const rp = regexProblem(src);
          if (rp) add("no-resource-bomb", `Regular expression /${src.slice(0, 40)}/ has ${rp} (heuristic check)`, n);
          if (regexHasNestedQuantifier(src)) add("no-resource-bomb", `Regular expression /${src.slice(0, 40)}/ has a quantified group that contains an unbounded quantifier (for example (a+)+); such patterns can take exponential time (heuristic check)`, n);
        } else if (typeof n.value === "string") {
          const v = n.value as string;
          if (!approvedDestinations.has(n) && namesForbiddenGlobal(v)) add("no-direct-klaviyo", `String literal "${v.slice(0, 40)}" names or fragments a forbidden global; events go through ${t.description}`, n);
          if (PRIVATE_FIELD.test(v) || /^(email|tel|password)$/i.test(v.trim())) add("sensitive-fields", `Touches a sensitive field ("${v.slice(0, 40)}"); never capture email, phone, payment or password fields`, n);
          if (SCRIPT_URL.test(v)) add("no-script-url", `String literal "${v.slice(0, 40)}" is a javascript:, data:, vbscript:, blob: or file: URL; URLs of those schemes run or smuggle code`, n);
          if (ENCODED_STRING.test(v) || ESCAPE_IN_SOURCE.test(String(n.raw))) {
            add("no-encoded-string", `String literal ${JSON.stringify(v.slice(0, 40))} contains an entity, percent or escape encoding; such strings are used to hide names, so write the plain text`, n);
          }
          if (parent?.type === "Property" && parent.key === n && DANGEROUS_KEYS.test(v)) add("no-dynamic-code", `"${v}" is forbidden as a key`, n);
        }
        break;
      }

      case "MemberExpression": {
        // folded constant strings: concatenation, joins, reversals, constant variables
        if (n.computed) {
          const text = foldedText(n.property);
          if (text !== undefined && namesForbiddenGlobal(text) && !approvedDestinations.has(n.property)) add("no-direct-klaviyo", `Constant expression builds a forbidden global name ("${text.slice(0, 40)}")`, n);
        }
        checkMember(n);
        break;
      }

      case "BinaryExpression":
      case "CallExpression": {
        if (n.type === "BinaryExpression") {
          if (BINARY.has(n.operator)) use("binary", n.operator);
          else add("allowlist-operator", `Operator ${n.operator} is not on the closed-world allowlist. ${REQUEST}`, n);
        }
        const text = foldedText(n);
        if (text !== undefined && namesForbiddenGlobal(text) && !approvedDestinations.has(n)) add("no-direct-klaviyo", `Constant expression builds a forbidden global name ("${text.slice(0, 40)}")`, n);
        if (text !== undefined && PRIVATE_FIELD.test(text)) add("sensitive-fields", `A constant expression builds a selector or string for a sensitive field ("${text.slice(0, 40)}"); never capture email, phone, payment or password fields`, n);
        if (n.type === "CallExpression") checkCall(n);
        break;
      }

      case "NewExpression": {
        const c = n.callee as N;
        if (isId(c, "URL") && an.isFree(c) && n.arguments.length >= 1 && n.arguments.length <= 2) {
          use("special", "new URL");
          for (const a of n.arguments as N[]) {
            const folded = foldedText(a);
            if (folded !== undefined && SCRIPT_URL.test(folded)) add("no-script-url", `new URL(${JSON.stringify(folded.slice(0, 40))}): a javascript:, data:, vbscript:, blob: or file: URL is refused`, n);
          }
        }
        else add("no-new", `"new ${c.type === "Identifier" ? c.name : "<expression>"}" is not allowed; only new URL(href, base) is on the allowlist. ${REQUEST}`, n);
        break;
      }

      case "AssignmentExpression":
        if (ASSIGN.has(n.operator)) use("assign", n.operator);
        else add("allowlist-operator", `Assignment operator ${n.operator} is not on the closed-world allowlist. ${REQUEST}`, n);
        checkAssignTarget(n.left, n);
        break;

      case "UpdateExpression":
        if (UPDATE.has(n.operator)) use("update", n.operator);
        else add("allowlist-operator", `Operator ${n.operator} is not allowed`, n);
        checkAssignTarget(n.argument, n);
        break;

      case "UnaryExpression":
        if (UNARY.has(n.operator)) use("unary", n.operator);
        else add("allowlist-operator", `Unary operator ${n.operator} is not on the closed-world allowlist. ${REQUEST}`, n);
        break;

      case "LogicalExpression":
        if (LOGICAL.has(n.operator)) use("logical", n.operator);
        break;

      case "Property":
        if (n.kind !== "init") add("allowlist-node", "Getters and setters in object literals are refused", n);
        break;

      case "TryStatement":
        tries.push(n);
        if (n.finalizer) add("allowlist-node", "try/finally is refused: nothing in the samples needs it, and a finally block can swallow a return or rethrow. Use try/catch only.", n);
        if (!n.handler) add("try-catch", "A try statement needs a catch clause", n);
        break;

      case "FunctionDeclaration":
        if (n.id.name === "track") trackDecls.push(n);
        break;

      case "VariableDeclaration":
        if (n.kind !== "var") add("es5", `${n.kind} is not ES5`, n);
        break;

      default:
        break;
    }
  }

  function checkCall(n: N) {
    const c = n.callee as N;
    const args = n.arguments as N[];

    if (c.type === "MemberExpression" && !c.computed && isSliceCall(c, an)) {
      for (let m: N = c; m.type === "MemberExpression"; m = m.object) {
        approved.add(m);
        approved.add(m.property);
      }
      approved.add(c.object.object.object);
      const listArg = args[0];
      const fromQuery = listArg?.type === "CallExpression" && listArg.callee.type === "MemberExpression" && !listArg.callee.computed && listArg.callee.property.name === "querySelectorAll";
      if (args.length === 1 && !fromQuery) add("no-resource-bomb", "Array.prototype.slice.call may only be given a querySelectorAll(...) result; any other array-like (an object with a length, a variable) can allocate a huge array (heuristic check)", n);
      if (args.length !== 1) add("allowlist-call", "Array.prototype.slice.call takes exactly one argument (the list)", n);
      else use("special", "Array.prototype.slice.call");
      use("global", "Array");
      return;
    }

    if (c.type === "Identifier") {
      const b = an.refBinding.get(c);
      if (b && !an.localFunction(b)) add("allowlist-call", `"${c.name}" is not a function declared in this script, so it cannot be called`, n);
      return;
    }
    if (c.type === "FunctionExpression") {
      const grand = an.parent.get(an.parent.get(n)!);
      if (!(an.parent.get(n)?.type === "ExpressionStatement" && grand === program)) add("allowlist-call", "Immediately-invoked functions are only allowed as the script's outer IIFE", n);
      return;
    }
    if (c.type !== "MemberExpression" || c.computed) {
      add("allowlist-call", "A call target must be a function declared in this script or an allowlisted method (x.name(...)); computed, chained and conditional call targets are refused", n);
      return;
    }

    const name = c.property.name as string;
    const obj = c.object as N;

    // transport
    if (name === t.member) {
      const [a0, a1] = args;
      const fn = an.functionOf(n);
      const nameParam = a0?.type === "Identifier" ? an.refBinding.get(a0) : undefined;
      const wellFormed =
        isId(obj, t.global) && an.isFree(obj) && args.length === 2 && a0?.type === "Identifier" && a1?.type === "Literal" && a1.value === t.destination &&
        nameParam?.kind === "param" && nameParam.param?.fn === fn && nameParam.param.index === 0 && nameParam.assigns.length === 0 && nameParam.updates.length === 0;
      if (!wellFormed) add("transport", `Hand-off must be exactly ${t.description}, where eventName is track()'s own first parameter, never reassigned`, n);
      else {
        transportCalls.push(n);
        approvedDestinations.add(a1!);
        use("special", "transport-call");
        if (!(fn.type === "FunctionDeclaration" && fn.id.name === "track")) add("transport", "The Heatmap hand-off may only be called from the track() helper", n);
      }
      return;
    }

    if (["querySelector", "querySelectorAll", "closest", "matches"].includes(name)) {
      const sels = args[0] ? flow.selectorStrings(args[0]) : null;
      if (!sels) {
        add("selector-static", `The selector passed to .${name}() must be a constant string (a literal, a concatenation of literals, or a rule-table \`rule.selector\`); a selector built at run time could be steered onto a password or payment field`, n);
      } else {
        for (const sel of sels) {
          const problem = selectorProblem(sel);
          if (problem) add("sensitive-fields", `Selector "${sel.slice(0, 50)}": ${problem}`, n);
          if (name === "closest" || name === "matches") {
            const hook = triggerSelectorProblem(sel);
            if (hook) add("trigger-selector", `Click-hook selector "${sel.slice(0, 50)}" ${hook}`, n);
          }
        }
      }
    }
    if (name === "replace" && !(args[0]?.type === "Literal" && args[0].regex)) {
      add("allowlist-call", ".replace() is allowed only as str.replace(/regex/, text); a string first argument could be location.replace(url)", n);
    }
    if ((name === "forEach" || name === "filter") && !isCallbackFunction(args[0])) {
      add("allowlist-call", `.${name}() needs a function expression or a function declared in this script as its callback`, n);
    }
    if (name === "addEventListener") {
      const first = args[0] ? foldedText(args[0]) : undefined;
      if (!isCallbackFunction(args[1])) add("allowlist-call", "addEventListener needs a function expression or a function declared in this script as its handler", n);
      if (first === "load") sawLoadListener = true;
      else listenerCalls.push(n);
    }
    // sessionStorage keys carry the site prefix
    if (isId(obj, "sessionStorage") && ["getItem", "setItem", "removeItem"].includes(name)) {
      const key = args[0];
      const prefix = `${options.siteSlug}_`;
      const candidates = key ? resolveKeyCandidates(key, n) : [];
      const resolved = candidates.map((k) => foldedText(k));
      if (name === "setItem" && inLoop(an, n)) add("no-resource-bomb", "sessionStorage.setItem inside a loop or a forEach/filter callback is refused: a loop that writes one key per pass fills the merchant's session storage (heuristic check)", n);
      if (key && pageDerived(key, 0)) add("session-key", "The sessionStorage key is built from page data (location, DOM text or values, attributes); a page-chosen key can overwrite the merchant site's own keys. Use a constant key with the site prefix", n);
      else if (resolved.length === 0 || resolved.some((r) => r === undefined)) add("session-prefix", "Cannot resolve the sessionStorage key to a constant", n, "warn");
      for (const r of resolved) if (r !== undefined && !r.startsWith(prefix)) add("session-prefix", `sessionStorage key "${r}" must start with "${prefix}"`, n);
    }
  }

  /** True when the expression reads the page: location/document/window members, DOM text/value/attribute reads, storage or JSON.parse results. Looks through one level of variables (declared inits and assigned values). */
  function pageDerived(expr: N, depth: number): boolean {
    if (depth > 6) return true;
    let found = false;
    walk(expr, (x) => {
      if (found) return;
      if (x.type === "Identifier") {
        if (an.isFree(x) && GLOBAL_OBJECTS.has(x.name) && x.name !== "Math") found = true;
        const b = an.refBinding.get(x);
        if (b && (b.kind === "var" || b.kind === "catch")) {
          if (b.kind === "catch") found = true;
          for (const v of [...b.inits, ...b.assigns.map((a) => a.value)]) if (pageDerived(v, depth + 1)) found = true;
        }
        if (b?.kind === "param" && b.param) {
          const owner = an.ownerOfFunction(b.param.fn);
          if (!owner || owner.escapes) found = true; // an event handler or callback: its parameter is page data
          else for (const c of owner.calls) {
            const arg = (c.arguments as N[])[b.param.index];
            if (arg && pageDerived(arg, depth + 1)) found = true;
          }
        }
      }
      if (x.type === "MemberExpression" && !x.computed && PAGE_READS.has(x.property.name)) found = true;
      if (x.type === "CallExpression" && x.callee.type === "MemberExpression" && !x.callee.computed && PAGE_CALLS.has(x.callee.property.name)) found = true;
    });
    return found;
  }

  /** A key that is a function parameter is resolved at every call site of that function. */
  function resolveKeyCandidates(key: N, at: N): N[] {
    if (key.type === "Identifier" && an.fold(key) === undefined) {
      const b = an.refBinding.get(key);
      if (b?.kind === "param" && b.param) {
        const owner = an.ownerOfFunction(b.param.fn);
        if (owner && !owner.escapes) return owner.calls.map((c) => (c.arguments as N[])[b.param!.index]).filter((a): a is N => a !== undefined);
      }
      return [];
    }
    void at;
    return [key];
  }

  // ---- static event names, selectors, loops, growth, recursion
  const nameResult = flow.analyze(trackDecls.length === 1 ? trackDecls[0] : undefined, add);
  for (const name of nameResult.names) eventNames.add(name);
  for (const name of nameResult.unreached) add("event-table-unreached", `Rule-table entry event: "${name}" is never passed to track(); remove it or use it`, undefined, "warn");
  // Scroll-depth tables: `percent:` must be a whole number from 1 to 100 (a literal), never 0, negative, fractional, a string or computed.
  for (const n of an.nodes) {
    if (n.type !== "Property") continue;
    const k = n.key.type === "Identifier" ? n.key.name : String(n.key.value);
    if (k !== "percent") continue;
    const v = n.value;
    const ok = v.type === "Literal" && typeof v.value === "number" && Number.isInteger(v.value) && v.value >= 1 && v.value <= 100;
    if (!ok) add("scroll-percent", "`percent:` must be a whole number literal from 1 to 100", n);
  }
  checkLoops(an, (rule, message, node) => add(rule, message, node), (u) => use("special", u));
  checkGrowth(an, (rule, message, node) => add(rule, message, node));
  checkDataFlow(an, (rule, message, node) => add(rule, message, node));
  checkListeners(an, (call) => ((call.arguments as N[])[0] ? foldedText((call.arguments as N[])[0]!) : undefined), (rule, message, node) => add(rule, message, node));
  checkRecursion(an, (rule, message, node) => add(rule, message, node));
  checkIndexes(an, (rule, message, node) => add(rule, message, node));
  checkArrayLikeAndJoin(an, (rule, message, node) => add(rule, message, node));

  if (sawReadyState === false || !sawLoadListener) add("shape", 'start() must run on "load", or immediately when document.readyState is "complete"');

  if (trackDecls.length !== 1) add("shape", `Expected exactly one track() helper, found ${trackDecls.length}`);
  if (transportCalls.length !== 1) {
    add("transport", `track() must hand events to Heatmap with exactly one ${t.description} call (found ${transportCalls.length} well-formed)`);
  }

  // ---- listeners wrapped in try/catch
  for (const call of listenerCalls) {
    const handler = (call.arguments as N[])[1];
    let fn: N | undefined = handler?.type === "FunctionExpression" ? handler : undefined;
    if (!fn && handler?.type === "Identifier") fn = an.localFunction(an.refBinding.get(handler));
    if (!fn) {
      add("try-catch", "Listener callback must be an inline or local function so its try/catch can be checked", call);
      continue;
    }
    const wrapped = tries.some((tr) => {
      let p: N | undefined = tr;
      while (p) {
        if (p === fn) return true;
        p = an.parent.get(p);
      }
      return false;
    });
    if (!wrapped) add("try-catch", "Listener callbacks must be wrapped in try/catch", call);
  }

  return { parsed: true, findings, eventNames, used };
}

/** Event names a script can emit (exact: names are statically constrained, see name-flow.ts). */
export function eventNamesFromSource(source: string, options: ScriptRuleOptions): Set<string> {
  return analyzeScript(source, options).eventNames;
}
