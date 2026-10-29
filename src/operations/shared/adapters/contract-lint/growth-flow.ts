// Data-flow screen for strings and arrays that grow from their own contents (memory bombs). It replaces "one more
// pattern per bypass" with a structural rule over every variable in the script, not just variables inside loops.
//
// Model. Every variable (var, parameter, catch parameter) is a node. Each assignment, initializer, push, call-site
// argument or forEach/filter parameter gives the node one or more ALTERNATIVE definitions; a definition lists which
// variables (with multiplicity) and constants its value is built from through size-propagating operations: `+`,
// concat, join, slice, replace, split, array and object literals, JSON.stringify, member reads of a container, local
// helper calls (through their return expressions and parameters). Temps and aliases are ordinary nodes, so
// `t = a.concat(b); a = t; b = t;` is the same graph as `a = a.concat(b)`.
//
//   1. Exponential growth: in a strongly connected component of that graph (a cycle through temps, aliases, helpers),
//      a definition that draws on the component's own variables with total multiplicity of 2 or more (a + a, [s, s, s],
//      a.concat(h) with h derived from a, Fibonacci a = a + b; b = a ...) doubles at least once per pass. Refused.
//      Flow-insensitive on purpose: it also refuses an unrolled straight-line chain, and a single `c = a + b; a = c; b = c`.
//   2. Budget: a size estimate propagates through the graph (a variable that accumulates inside a loop, or inside a
//      helper called from a loop, counts as 1000 times what it accumulates). A variable whose estimate exceeds
//      SIZE_BUDGET is refused. That catches unrolled doubling chains through distinct variables and accumulators
//      feeding accumulators (a += b; b += c; ...) which grow polynomially to gigabytes.
//   Bounded results are not counted: slice/substring/substr with literal bounds, charAt, numbers, booleans, lengths, DOM lookups.
//
// HEURISTIC. Conservative and flow-insensitive; it refuses some harmless code and does not model growth that goes
// through the DOM, sessionStorage, regex backreferences or engine behavior. Not a boundary (Deferred D6).
import type { Node } from "acorn";
import type { Analysis, Binding } from "./script-rules.ts";
import { inLoop } from "./resource-rules.ts";

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes are walked structurally
type N = Node & Record<string, any>;

type AddFinding = (rule: string, message: string, node?: N) => void;

/** One way a value can be built: the variables it draws on (with multiplicity) and how many constants. */
interface Alt {
  w: Map<Binding, number>;
  c: number;
  node?: N;
}

/** Largest size estimate (in "units": one literal, or one unknown value) any variable may reach. */
export const SIZE_BUDGET = 200_000;
/** Assumed number of passes of a loop (the loop rules cap literal bounds at 1000; `.length` bounds are not capped). */
export const LOOP_FACTOR = 1000;
const MAX_ALTS = 32;
const SIZE_CAP = 1e15;

const CONST: Alt[] = [{ w: new Map(), c: 1 }];

/** Methods whose result does not carry the size of the receiver or the arguments (numbers, booleans, DOM nodes, one character, storage reads). */
const NO_SIZE_METHODS = new Set([
  "closest", "matches", "contains", "getAttribute", "querySelector", "querySelectorAll", "getBoundingClientRect", "indexOf", "charAt", "test",
  "getItem", "setItem", "removeItem", "getElementById", "matchMedia", "getComputedStyle", "addEventListener", "abs", "floor", "round", "log", "push", "forEach",
]);
/** Members whose read is a number or a short value, not a copy of the container. */
const NO_SIZE_MEMBERS = new Set(["length", "scrollHeight", "selectedIndex", "clientX", "clientY", "nodeType", "width", "height", "bottom", "left", "right", "scrollY", "innerHeight"]);

/** Read-only page members: on an element, event or other non-plain value they return page-controlled data of their own. */
const PAGE_MEMBERS = new Set(["value", "text", "textContent", "innerText", "id", "name", "href", "search", "pathname", "origin", "options", "target", "nodeName", "tagName", "classList", "parentElement", "touches", "changedTouches", "disabled", "display", "visibility", "documentElement", "body"]);

const sumAlts = (a: Alt[], b: Alt[]): Alt[] => {
  if (a.length * b.length > MAX_ALTS) {
    // Too many combinations: collapse each side by adding its alternatives up (an over-estimate, never an under-estimate).
    const collapse = (x: Alt[]): Alt => x.reduce((acc, y) => mergeSum(acc, y), { w: new Map(), c: 0 });
    return [mergeSum(collapse(a), collapse(b))];
  }
  const out: Alt[] = [];
  for (const x of a) for (const y of b) out.push(mergeSum(x, y));
  return out;
};
function mergeSum(x: Alt, y: Alt): Alt {
  const w = new Map(x.w);
  for (const [k, v] of y.w) w.set(k, (w.get(k) ?? 0) + v);
  return { w, c: x.c + y.c, ...(x.node ? { node: x.node } : y.node ? { node: y.node } : {}) };
}
const scaleAlts = (a: Alt[], k: number): Alt[] => a.map((x) => ({ w: new Map([...x.w].map(([b, v]) => [b, v * k] as [Binding, number])), c: x.c * k }));
const unionAlts = (...lists: Alt[][]): Alt[] => {
  const all = lists.flat();
  if (all.length <= MAX_ALTS) return all;
  const total = all.reduce((acc, y) => mergeSum(acc, y), { w: new Map<Binding, number>(), c: 0 });
  return [total];
};

/** slice/substring/substr with literal bounds give a result no longer than the literal span, whatever the receiver. */
function boundedCut(method: string, args: N[]): boolean {
  if (!["slice", "substring", "substr"].includes(method)) return false;
  const num = (a: N | undefined): number | undefined => {
    if (!a) return undefined;
    if (a.type === "Literal" && typeof a.value === "number") return a.value;
    if (a.type === "UnaryExpression" && a.operator === "-" && a.argument.type === "Literal" && typeof a.argument.value === "number") return -a.argument.value;
    return undefined;
  };
  const a0 = num(args[0]);
  const a1 = num(args[1]);
  if (method === "substr") return a1 !== undefined && a1 >= 0 && a1 <= 1000;
  if (a0 === undefined) return false;
  if (args.length === 1) return a0 < 0 && a0 >= -1000; // slice(-5): last five
  if (a1 === undefined) return false;
  if (method === "substring") return Math.abs(a1 - a0) <= 1000;
  return (a0 >= 0 && a1 >= 0 && a1 - a0 <= 1000) || (a0 < 0 && a1 < 0 && a1 - a0 <= 1000);
}

/** Local function a call names directly. */
const targetOf = (an: Analysis, call: N): N | undefined => {
  const c = call.callee as N;
  return c.type === "Identifier" ? an.localFunction(an.refBinding.get(c)) : undefined;
};
/** Function expressions and local functions handed to a call as arguments (callbacks). */
const callbacksOf = (an: Analysis, call: N): N[] => {
  const out: N[] = [];
  for (const a of call.arguments as N[]) {
    if (a.type === "FunctionExpression") out.push(a);
    else if (a.type === "Identifier") {
      const f = an.localFunction(an.refBinding.get(a));
      if (f) out.push(f);
    }
  }
  return out;
};

/**
 * Which code runs inside a loop: lexically inside a for loop or forEach/filter callback, or inside a function that is
 * called (or passed as a callback) from such code, transitively.
 */
export function loopContext(an: Analysis) {
  const looped = new Set<N>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of an.nodes) {
      if (n.type !== "CallExpression") continue;
      if (!(inLoop(an, n) || looped.has(an.functionOf(n)))) continue;
      for (const f of [targetOf(an, n), ...callbacksOf(an, n)]) {
        if (f && !looped.has(f)) {
          looped.add(f);
          changed = true;
        }
      }
    }
  }
  const inLoopContext = (node: N): boolean => {
    if (inLoop(an, node)) return true;
    for (let f: N | undefined = an.functionOf(node); f && f !== an.program; f = an.functionOf(f)) if (looped.has(f)) return true;
    return false;
  };
  return { looped, inLoopContext, callTargets: (call: N) => targetOf(an, call), callbackTargets: (call: N) => callbacksOf(an, call) };
}

export function checkDataFlow(an: Analysis, add: AddFinding): void {
  const { callTargets, callbackTargets, inLoopContext } = loopContext(an);

  // ---- definitions ----
  const defs = new Map<Binding, Alt[]>();
  const addDef = (b: Binding | undefined, alts: Alt[], node: N) => {
    if (!b || (b.kind !== "var" && b.kind !== "param" && b.kind !== "catch")) return;
    const list = defs.get(b) ?? defs.set(b, []).get(b)!;
    for (const a of alts) list.push({ ...a, node });
  };

  const returnAlts = new Map<N, Alt[]>();
  const inProgress = new Set<N>();
  const returnsOf = (fn: N): Alt[] => {
    const known = returnAlts.get(fn);
    if (known) return known;
    if (inProgress.has(fn)) return CONST; // recursion is refused elsewhere
    inProgress.add(fn);
    const rets = an.returnsOf(fn).filter((r) => r.argument);
    const alts = rets.length === 0 ? CONST : unionAlts(...rets.map((r) => contrib(r.argument)));
    inProgress.delete(fn);
    returnAlts.set(fn, alts);
    return alts;
  };

  function contrib(e: N | null | undefined): Alt[] {
    if (!e) return CONST;
    switch (e.type) {
      case "Identifier": {
        const b = an.refBinding.get(e);
        if (b && (b.kind === "var" || b.kind === "param" || b.kind === "catch")) return [{ w: new Map([[b, 1]]), c: 0 }];
        return CONST;
      }
      case "Literal":
        return CONST;
      case "BinaryExpression":
        return e.operator === "+" ? sumAlts(contrib(e.left), contrib(e.right)) : CONST;
      case "LogicalExpression":
        return unionAlts(contrib(e.left), contrib(e.right));
      case "ConditionalExpression":
        return unionAlts(contrib(e.consequent), contrib(e.alternate));
      case "SequenceExpression":
        return contrib(e.expressions[e.expressions.length - 1]);
      case "UnaryExpression":
      case "UpdateExpression":
        return CONST;
      case "AssignmentExpression":
        return e.operator === "+=" ? sumAlts(contrib(e.left), contrib(e.right)) : e.operator === "=" ? contrib(e.right) : CONST;
      case "MemberExpression": {
        if (!e.computed && NO_SIZE_MEMBERS.has(e.property.name)) return CONST;
        // A page read (.value, .textContent, .options ...) on something that is not a container this script built returns page data, not a copy of the variable.
        if (!e.computed && PAGE_MEMBERS.has(e.property.name)) {
          let cur: N = e;
          while (cur.type === "MemberExpression") cur = cur.object;
          const root = cur.type === "Identifier" ? an.refBinding.get(cur) : undefined;
          if (!root || !an.isPlainBinding(root)) return CONST;
        }
        return contrib(e.object);
      }
      case "ArrayExpression":
        return (e.elements as (N | null)[]).reduce((acc: Alt[], el) => sumAlts(acc, contrib(el)), CONST);
      case "ObjectExpression":
        return (e.properties as N[]).reduce((acc: Alt[], p) => sumAlts(acc, contrib(p.value)), CONST);
      case "NewExpression":
        return (e.arguments as N[]).reduce((acc: Alt[], a) => sumAlts(acc, contrib(a)), CONST);
      case "CallExpression":
        return callContrib(e);
      default:
        return CONST;
    }
  }

  function callContrib(e: N): Alt[] {
    const c = e.callee as N;
    const args = e.arguments as N[];
    const sumArgs = (from: Alt[]) => args.reduce((acc, a) => sumAlts(acc, contrib(a)), from);
    if (c.type === "Identifier") {
      const f = an.localFunction(an.refBinding.get(c));
      return f ? returnsOf(f) : sumArgs(CONST);
    }
    if (c.type !== "MemberExpression" || c.computed) return sumArgs(CONST);
    const m = c.property.name as string;
    if (NO_SIZE_METHODS.has(m)) return CONST;
    if (boundedCut(m, args)) return CONST;
    const recv = contrib(c.object);
    if (m === "join") {
      // join("") keeps the length; any other separator (or the default ",") is inserted between elements, which can double a list of one-character pieces
      const emptySep = args[0]?.type === "Literal" && args[0].value === "";
      return emptySep ? recv : sumAlts(scaleAlts(recv, 2), args[0] ? scaleAlts(contrib(args[0]), 2) : CONST);
    }
    if (m === "replace") return sumAlts(recv, args[1] ? scaleAlts(contrib(args[1]), 2) : CONST);
    // concat, split, slice, trim, case changes, filter, JSON.parse/stringify, Array.prototype.slice.call and the rest: receiver plus every argument
    return sumArgs(recv);
  }

  // Initializers, assignments, pushes, call-site arguments, callback parameters.
  const rootOf = (node: N): Binding | undefined => {
    let cur: N = node;
    while (cur.type === "MemberExpression") cur = cur.object;
    return cur.type === "Identifier" ? an.refBinding.get(cur) : undefined;
  };
  for (const n of an.nodes) {
    if (n.type === "VariableDeclarator" && n.init) addDef(an.bindingOfDecl(n.id), contrib(n.init), n);
    if (n.type === "AssignmentExpression" && (n.operator === "=" || n.operator === "+=")) {
      const target = n.left as N;
      const b = rootOf(target);
      if (!b) continue;
      let alts: Alt[];
      if (target.type === "Identifier") alts = n.operator === "=" ? contrib(n.right) : sumAlts(contrib(target), contrib(n.right));
      else {
        // o.p = E / o[i] = E: the container keeps its old content apart from the replaced part, so take the larger of the old size and E's
        alts = contrib(n.right).map((a) => {
          const w = new Map(a.w);
          w.set(b, Math.max(w.get(b) ?? 0, 1));
          return { w, c: a.c };
        });
      }
      addDef(b, alts, n);
    }
    if (n.type === "CallExpression") {
      const c = n.callee as N;
      if (c.type === "MemberExpression" && !c.computed && c.property.name === "push") {
        const b = rootOf(c.object);
        if (b) addDef(b, (n.arguments as N[]).reduce((acc: Alt[], a) => sumAlts(acc, contrib(a)), [{ w: new Map([[b, 1]]), c: 0 }]), n);
      }
      const f = callTargets(n);
      if (f) (f.params as N[]).forEach((p, i) => addDef(an.bindingOfDecl(p), (n.arguments as N[])[i] ? contrib((n.arguments as N[])[i]) : CONST, n));
      if (c.type === "MemberExpression" && !c.computed && (c.property.name === "forEach" || c.property.name === "filter")) {
        const recv = contrib(c.object);
        for (const cb of callbackTargets(n)) {
          const p0 = (cb.params as N[])[0];
          if (p0) addDef(an.bindingOfDecl(p0), recv, n);
        }
      }
    }
  }

  // ---- strongly connected components (Tarjan); a component is emitted after everything it depends on ----
  const nodes = [...defs.keys()];
  const index = new Map<Binding, number>();
  const low = new Map<Binding, number>();
  const onStack = new Set<Binding>();
  const stack: Binding[] = [];
  const comps: Binding[][] = [];
  let counter = 0;
  const connect = (v: Binding) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const alt of defs.get(v) ?? []) {
      for (const w of alt.w.keys()) {
        if (!defs.has(w)) continue;
        if (!index.has(w)) {
          connect(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: Binding[] = [];
      let w: Binding;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      comps.push(comp);
    }
  };
  for (const v of nodes) if (!index.has(v)) connect(v);

  const size = new Map<Binding, number>();
  const sizeOf = (b: Binding): number => size.get(b) ?? 1;
  const reported = new Set<Binding>();
  const say = (b: Binding, node: N | undefined, text: string) => {
    if (reported.has(b)) return;
    reported.add(b);
    add("no-resource-bomb", text, node);
  };

  for (const comp of comps) {
    const inComp = new Set(comp);
    const cyclic = comp.length > 1 || (defs.get(comp[0]!) ?? []).some((a) => a.w.has(comp[0]!));
    let externalMax = 0;
    let accumulates = false;
    let accumulatesInLoop = false;
    for (const b of comp) {
      for (const alt of defs.get(b) ?? []) {
        let inside = 0;
        let outside = alt.c;
        for (const [d, k] of alt.w) {
          if (inComp.has(d)) inside += k;
          else outside += k * sizeOf(d);
        }
        externalMax = Math.max(externalMax, outside);
        if (cyclic && inside >= 2) {
          const names = comp.map((x) => x.name).filter((v, i, all) => all.indexOf(v) === i).join(", ");
          say(b, alt.node, `"${b.name}" is rebuilt from its own contents more than once per pass (through ${comp.length > 1 ? `the variables ${names}` : "itself"}): a value that reaches itself with multiplicity ${inside} at least doubles each time the code runs, so a loop or a chain of statements exhausts memory. Aliases and temporaries do not hide it (heuristic data-flow check)`);
        }
        if (cyclic && inside === 1 && outside > 0) {
          accumulates = true;
          if (alt.node && inLoopContext(alt.node)) accumulatesInLoop = true;
        }
      }
    }
    const base = Math.max(externalMax, 1);
    const compSize = Math.min(SIZE_CAP, cyclic && accumulates ? (accumulatesInLoop ? base * LOOP_FACTOR : base * 2) : base);
    for (const b of comp) size.set(b, compSize);
    if (compSize > SIZE_BUDGET) {
      const b = comp[0]!;
      const alt = (defs.get(b) ?? [])[0];
      say(b, alt?.node, `"${b.name}" can grow to about ${compSize >= SIZE_CAP ? "an unbounded size" : String(Math.round(compSize))} units through chained copies or accumulators (limit ${SIZE_BUDGET}); a variable that accumulates in a loop is counted ${LOOP_FACTOR} times what it adds, and accumulators feeding accumulators grow polynomially. Build it from one accumulator or bound the data (heuristic data-flow check)`);
    }
  }
}
