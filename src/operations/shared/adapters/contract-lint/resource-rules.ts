// Resource-bomb rules. HEURISTICS ONLY: they refuse the shapes known to hang or exhaust a page (unbounded loops,
// recursion, nested-quantifier regexes, doubling strings) and cannot prove a script is cheap. A script that
// passes them can still be slow (for example a bounded loop that calls an expensive allowed API), and the
// regex check does not understand alternation overlap such as (a|a)*. The real answer is the isolated
// per-job container with CPU and memory limits (Deferred D6).
import type { Node } from "acorn";
import type { Analysis, Binding } from "./script-rules.ts";

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes are walked structurally
type N = Node & Record<string, any>;

export const MAX_LOOP_BOUND = 1000;
export const MAX_LOOP_NESTING = 2;
/** Largest counted regex repeat ({n}, {n,m}) and largest number of unbounded quantifiers in one regex literal. */
export const MAX_REGEX_COUNT = 20;
export const MAX_REGEX_UNBOUNDED = 4;
/** Largest numeric array index a script may write or read (a[4294967294] = 1 makes a sparse array that join() expands). */
export const MAX_INDEX = 1000;
/** An array written at a numeric index above this (or given a length above it) may not be joined: a sparse array turns join() into a string of length index times separator. */
export const MAX_JOIN_INDEX = 100;
/** join() separators must be string literals of at most this many characters (round 10). */
export const MAX_JOIN_SEPARATOR = 4;
/** At most this many global replace / split-join calls per script (each may grow a string by a constant factor; the cap keeps a chain of them small). */
export const MAX_GROWTH_OPS = 8;

export type AddFinding = (rule: string, message: string, node?: N) => void;

/** True when the pattern has a group that contains an unbounded quantifier (+ * {n,}) and is itself followed by one. Heuristic. */
export function regexHasNestedQuantifier(pattern: string): boolean {
  const stack: { has: boolean }[] = [];
  let inClass = false;
  const unboundedAt = (i: number): number => {
    // length of an unbounded quantifier starting at i, or 0
    const c = pattern[i];
    if (c === "+" || c === "*") return 1;
    if (c === "{") {
      const m = /^\{\d+,\}/.exec(pattern.slice(i));
      return m ? m[0].length : 0;
    }
    return 0;
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      stack.push({ has: false });
      if (pattern[i + 1] === "?") i += 2; // (?:  (?=  (?!
      continue;
    }
    if (c === ")") {
      const g = stack.pop();
      const q = unboundedAt(i + 1);
      if (g?.has && q > 0) return true;
      const parent = stack[stack.length - 1];
      if (parent && (g?.has || q > 0)) parent.has = true;
      if (q > 0) i += q;
      continue;
    }
    const q = unboundedAt(i);
    if (q > 0) {
      const top = stack[stack.length - 1];
      if (top) top.has = true;
      i += q - 1;
    }
  }
  return false;
}

interface Quant {
  len: number;
  kind: "unbounded" | "optional" | "counted";
  /** Largest repeat count named (counted), or the minimum for {n,}. */
  max: number;
}
/** The quantifier that starts at pattern[i], if any (a lazy `?` suffix is included in len). */
function quantifierAt(pattern: string, i: number): Quant | undefined {
  const c = pattern[i];
  let q: Quant | undefined;
  if (c === "+" || c === "*") q = { len: 1, kind: "unbounded", max: 0 };
  else if (c === "?") q = { len: 1, kind: "optional", max: 1 };
  else if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i, i + 24));
    if (m) {
      const lo = Number(m[1]);
      if (m[2] !== undefined && m[3] === "") q = { len: m[0].length, kind: "unbounded", max: lo };
      else q = { len: m[0].length, kind: "counted", max: m[3] ? Number(m[3]) : lo };
    }
  }
  if (q && pattern[i + q.len] === "?" && q.kind !== "optional") q.len++;
  return q;
}

/**
 * Heuristic screen for regex shapes that backtrack badly. Refuses: a repeated group that contains an alternation
 * (`(a|aa)+`, `(\w|\d)+`, `(a|a?)+`) or any other quantifier (`(.*a){25}`, `(a?){60}`, `(a+)+`); counted repeats above
 * 20 (`a{60}`); more than 4 unbounded quantifiers in one literal (`.*.*.*.*.*`). Returns a description or undefined.
 * A heuristic, not a proof: it is deliberately conservative and some harmless patterns are refused.
 */
export function regexProblem(pattern: string): string | undefined {
  const stack: { alt: boolean; quant: boolean }[] = [];
  let inClass = false;
  let unbounded = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      stack.push({ alt: false, quant: false });
      if (pattern[i + 1] === "?") i += 2; // (?:  (?=  (?!
      continue;
    }
    if (c === "|") {
      const top = stack[stack.length - 1];
      if (top) top.alt = true;
      continue;
    }
    if (c === ")") {
      const g = stack.pop();
      const q = quantifierAt(pattern, i + 1);
      const repeats = !!q && (q.kind === "unbounded" || (q.kind === "counted" && q.max > 1));
      if (q) {
        if (q.kind === "unbounded") unbounded++;
        if (q.kind !== "optional" && q.max > MAX_REGEX_COUNT) return `a counted repeat of ${q.max} (above ${MAX_REGEX_COUNT})`;
        i += q.len;
      }
      if (g && repeats && g.alt) return "a repeated group that contains an alternation (for example (a|aa)+), which can backtrack exponentially";
      if (g && repeats && g.quant) return "a repeated group that contains another quantifier (for example (a+)+ or (.*a){25}), which can backtrack exponentially";
      const parent = stack[stack.length - 1];
      if (parent && g) {
        parent.alt = parent.alt || g.alt;
        parent.quant = parent.quant || g.quant || !!q;
      }
      continue;
    }
    const q = quantifierAt(pattern, i);
    if (q) {
      if (q.kind === "unbounded") unbounded++;
      if (q.kind !== "optional" && q.max > MAX_REGEX_COUNT) return `a counted repeat of ${q.max} (above ${MAX_REGEX_COUNT})`;
      const top = stack[stack.length - 1];
      if (top) top.quant = true;
      i += q.len - 1;
    }
  }
  if (unbounded > MAX_REGEX_UNBOUNDED) return `${unbounded} unbounded quantifiers (more than ${MAX_REGEX_UNBOUNDED}); chains like .*.*.*.* are polynomial`;
  return undefined;
}

export const walk = (node: N, visit: (n: N) => void) => {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") walk(c, visit);
    } else if (v && typeof v === "object" && typeof v.type === "string") walk(v, visit);
  }
};

const countRefs = (an: Analysis, node: N, binding: Binding): number => {
  let n = 0;
  walk(node, (x) => {
    if (x.type === "Identifier" && an.refBinding.get(x) === binding) n++;
  });
  return n;
};

const isIterationCallback = (an: Analysis, fn: N): boolean => {
  const call = an.parent.get(fn);
  return fn.type === "FunctionExpression" && !!call && call.type === "CallExpression" && call.arguments[0] === fn && call.callee.type === "MemberExpression" && !call.callee.computed && ["forEach", "filter"].includes(call.callee.property.name);
};

/** True when the node sits inside a for loop or a forEach/filter callback. */
export const inLoop = (an: Analysis, node: N): boolean => {
  for (let p = an.parent.get(node); p; p = an.parent.get(p)) {
    if (p.type === "ForStatement") return true;
    if (isIterationCallback(an, p)) return true;
  }
  return false;
};

/** The only loop shape: for (var i = <number>; i < <number <= 1000> | <expr>.length; i++), with i untouched in the body. */
export function checkLoops(an: Analysis, add: AddFinding, use: (name: string) => void): void {
  for (const n of an.nodes) {
    if (n.type === "WhileStatement" || n.type === "DoWhileStatement") {
      add("no-unbounded-loop", `${n.type === "WhileStatement" ? "while" : "do..while"} loops are forbidden: they can spin forever. Use for (var i = 0; i < list.length; i++) or a numeric literal bound of at most ${MAX_LOOP_BOUND}`, n);
      continue;
    }
    if (n.type !== "ForStatement") continue;
    const shape = `for (var i = <number>; i < <number up to ${MAX_LOOP_BOUND}> or <list>.length; i++)`;
    const init = n.init as N | null;
    const decl = init && init.type === "VariableDeclaration" && init.declarations.length === 1 ? (init.declarations[0] as N) : undefined;
    const binding = decl && decl.id.type === "Identifier" ? an.bindingOfDecl(decl.id) : undefined;
    const startOk = !!decl && decl.init?.type === "Literal" && typeof decl.init.value === "number" && decl.init.value >= 0;
    const test = n.test as N | null;
    const testLeft = test?.type === "BinaryExpression" && test.operator === "<" && test.left.type === "Identifier" && !!binding && an.refBinding.get(test.left) === binding;
    const right = test?.right as N | undefined;
    const boundOk =
      !!right &&
      ((right.type === "Literal" && typeof right.value === "number" && right.value > 0 && right.value <= MAX_LOOP_BOUND) ||
        (right.type === "MemberExpression" && !right.computed && right.property.name === "length"));
    const update = n.update as N | null;
    const updateOk = update?.type === "UpdateExpression" && update.operator === "++" && update.argument.type === "Identifier" && !!binding && an.refBinding.get(update.argument) === binding;
    // The counter is changed only by the update clause of for loops (so two sequential loops may reuse `i`, nothing else can move it).
    const untouched =
      !!binding &&
      binding.assigns.length === 0 &&
      binding.updates.every((u) => {
        const loop = an.parent.get(u);
        return loop?.type === "ForStatement" && loop.update === u;
      });
    let sharesCounter = false;
    for (let p = an.parent.get(n); p && binding; p = an.parent.get(p)) {
      if (p.type === "ForStatement" && p.init?.type === "VariableDeclaration" && p.init.declarations[0]?.id && an.bindingOfDecl(p.init.declarations[0].id) === binding) sharesCounter = true;
    }
    if (sharesCounter) add("no-unbounded-loop", "A nested loop reuses the counter of the loop around it, which can keep the outer loop from ever finishing; use another variable", n);
    if (!(startOk && testLeft && boundOk && updateOk && untouched)) {
      const bigLiteral = right?.type === "Literal" && typeof right.value === "number" && right.value > MAX_LOOP_BOUND;
      add("no-unbounded-loop", `Loop is not the bounded form ${shape}${bigLiteral ? `; the numeric bound ${right!.value} is above ${MAX_LOOP_BOUND}` : ""}. The counter must start at a number, be compared with < against a literal or .length, go up by ++ only, and not be changed in the body`, n);
    } else {
      use("bounded-for");
      // a .length bound on a list the body pushes to never ends
      if (right?.type === "MemberExpression" && right.object.type === "Identifier") {
        const listBinding = an.refBinding.get(right.object);
        walk(n.body, (x) => {
          if (listBinding && x.type === "CallExpression" && x.callee.type === "MemberExpression" && !x.callee.computed && x.callee.property.name === "push" && x.callee.object.type === "Identifier" && an.refBinding.get(x.callee.object) === listBinding) {
            add("no-unbounded-loop", `The loop bound is ${right.object.name}.length and the body pushes to ${right.object.name}, so the loop may never end`, x);
          }
        });
      }
    }
    // a .length bound whose subject is assigned in the body (s.length with s = s + "a") can keep growing as fast as the counter
    if (right?.type === "MemberExpression" && !right.computed && right.property.name === "length") {
      const root = rootBinding(an, right.object);
      if (root) {
        walk(n.body, (x) => {
          // an element write at the loop counter (list[i] = v) cannot lengthen the list; any other write to the subject can
          if (x.type !== "AssignmentExpression") return;
          const atCounter = x.left.type === "MemberExpression" && x.left.computed && x.left.property.type === "Identifier" && an.refBinding.get(x.left.property) === binding && x.left.object.type === "Identifier";
          if (rootBinding(an, x.left) === root && !atCounter) {
            add("no-unbounded-loop", `The loop bound depends on "${root.name}", which the body assigns to; a bound that changes inside the loop may never be reached`, x);
          }
        });
      }
    }
    const depth = loopDepth(an, n);
    if (depth > MAX_LOOP_NESTING) add("no-unbounded-loop", `Loops (for, and forEach/filter callbacks) are nested ${depth} deep; at most ${MAX_LOOP_NESTING} levels are allowed (nested bounds multiply)`, n);
  }
  // forEach/filter callbacks iterate a DOM list or array: they count as loops for nesting.
  for (const n of an.nodes) {
    if (n.type === "FunctionExpression" && isIterationCallback(an, n)) {
      const depth = loopDepth(an, n);
      if (depth > MAX_LOOP_NESTING) add("no-unbounded-loop", `Loops (for, and forEach/filter callbacks) are nested ${depth} deep; at most ${MAX_LOOP_NESTING} levels are allowed (nested bounds multiply)`, n);
    }
  }
}

/** 1 for a loop with no loop around it; counts for statements and forEach/filter callbacks among the ancestors. */
function loopDepth(an: Analysis, node: N): number {
  let depth = 1;
  for (let p = an.parent.get(node); p; p = an.parent.get(p)) if (p.type === "ForStatement" || isIterationCallback(an, p)) depth++;
  return depth;
}

/** The variable at the root of `x`, `x.a`, `x[i]`, `x.a.b` (undefined for anything else). */
function rootBinding(an: Analysis, node: N): Binding | undefined {
  let cur: N = node;
  while (cur.type === "MemberExpression") cur = cur.object;
  return cur.type === "Identifier" ? an.refBinding.get(cur) : undefined;
}

/** Operands of a left-to-right chain of `+`. */
function plusOperands(node: N, out: N[] = []): N[] {
  if (node.type === "BinaryExpression" && node.operator === "+") {
    plusOperands(node.left, out);
    plusOperands(node.right, out);
  } else out.push(node);
  return out;
}

/** Methods whose result is (a transformed copy of) the receiver: s.slice(0), s.trim(), s.concat(x) ... */
const COPY_METHODS = new Set(["slice", "substring", "trim", "toLowerCase", "toUpperCase", "concat", "replace", "join", "charAt", "split"]);

/** The variable an operand copies: `s`, `s.slice(0)`, `s.trim().concat(x)`; not `s.id` or `s.options[0]` (those read something else). */
function copyRoot(an: Analysis, node: N): Binding | undefined {
  let cur: N = node;
  for (let d = 0; d < 20; d++) {
    if (cur.type === "Identifier") {
      const b = an.refBinding.get(cur);
      return b && b.kind !== "function" ? b : undefined;
    }
    if (cur.type === "CallExpression" && cur.callee.type === "MemberExpression" && !cur.callee.computed && COPY_METHODS.has(cur.callee.property.name)) cur = cur.callee.object;
    else return undefined;
  }
  return undefined;
}

const GROWING_METHODS = new Set(["replace", "split", "join", "concat"]);

/**
 * Strings or arrays that grow from their own contents. All heuristics:
 *  - a `+` chain, `+=` or concat/push that uses the same variable twice (s + s, s += s, s.concat(s), [s, s].join("")), anywhere, not only in loops
 *  - in a loop, an assignment whose right side reads the assigned variable and goes through replace/split/join/concat or a function of this script
 *  - replace(/re/g, text) with a replacement that is not a single character, split(a).join(b) with b longer than a: both can lengthen a string, at most 8 per script
 */
export function checkGrowth(an: Analysis, add: AddFinding): void {
  let growthOps = 0;
  for (const n of an.nodes) {
    // s + s, s + "-" + s (any number of operands, same variable twice)
    if (n.type === "BinaryExpression" && n.operator === "+" && !(an.parent.get(n)?.type === "BinaryExpression" && an.parent.get(n)!.operator === "+")) {
      const seen = new Map<Binding, number>();
      for (const operand of plusOperands(n)) {
        const b = copyRoot(an, operand);
        if (b) seen.set(b, (seen.get(b) ?? 0) + 1);
      }
      for (const [b, count] of seen) {
        if (count >= 2) add("no-resource-bomb", `"${b.name}" (or a copy of it) is used ${count} times in one + expression; repeated, that doubles a string each time and exhausts memory (heuristic check)`, n);
      }
    }
    if (n.type === "AssignmentExpression" && n.operator === "+=" && n.left.type === "Identifier") {
      const b = an.refBinding.get(n.left);
      if (b && countRefs(an, n.right, b) >= 1) add("no-resource-bomb", `"${n.left.name}" += an expression that reads "${n.left.name}" itself doubles it each time (heuristic check)`, n);
    }
    // in a loop: x = <a call that copies x into its own result more than once, or hands x to a function of this script>
    if (n.type === "AssignmentExpression" && n.operator === "=" && inLoop(an, n)) {
      const root = rootBinding(an, n.left);
      if (root && countRefs(an, n.right, root) >= 1) {
        let risky = countRefs(an, n.right, root) >= 2;
        walk(n.right, (x) => {
          if (x.type !== "CallExpression") return;
          const c = x.callee as N;
          const argsRead = (x.arguments as N[]).some((a) => countRefs(an, a, root) > 0);
          if (argsRead && c.type === "MemberExpression" && !c.computed && GROWING_METHODS.has(c.property.name)) risky = true;
          if (argsRead && c.type === "Identifier" && an.localFunction(an.refBinding.get(c))) risky = true;
        });
        if (risky) add("no-resource-bomb", `"${root.name}" is reassigned inside a loop from an expression that reads "${root.name}" more than once or passes it to concat/replace/split/join or to a function of this script (for example s = dbl(s)); that can double it every pass. Assign to a different variable or build the result outside the loop (heuristic check)`, n);
      }
    }
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed) {
      const method = n.callee.property.name as string;
      const args = n.arguments as N[];
      // x.push(x), x.concat(x) (anywhere: a chain of them doubles too)
      if (["push", "concat"].includes(method) && n.callee.object.type === "Identifier") {
        const b = an.refBinding.get(n.callee.object);
        if (b && args.some((a) => countRefs(an, a, b) > 0)) {
          add("no-resource-bomb", `${n.callee.object.name}.${method}() is given ${n.callee.object.name} itself; the collection grows from its own contents`, n);
        }
      }
      // [s, s].join("") and the same through concat
      if (method === "join" && n.callee.object.type === "ArrayExpression") {
        const seen = new Map<Binding, number>();
        for (const el of n.callee.object.elements as (N | null)[]) {
          if (el?.type === "Identifier") {
            const b = an.refBinding.get(el);
            if (b) seen.set(b, (seen.get(b) ?? 0) + 1);
          }
        }
        for (const [b, count] of seen) if (count >= 2) add("no-resource-bomb", `[${b.name}, ${b.name}].join(...) repeats "${b.name}"; that doubles it (heuristic check)`, n);
      }
      // replace(/re/g, text): the replacement must be a single character or less, or a global replace can lengthen the string
      if (method === "replace" && args[0]?.type === "Literal" && args[0].regex && /g/.test(args[0].regex.flags ?? "")) {
        growthOps++;
        const rep = args[1];
        const ok = rep?.type === "Literal" && typeof rep.value === "string" && rep.value.length <= 1;
        if (!ok) add("no-resource-bomb", `.replace(/.../g, x) must replace with a string literal of at most one character; a longer or computed replacement lengthens the string for every match and can be repeated into a memory bomb (heuristic check)`, n);
      }
      // split(a).join(b) with b longer than a
      if (method === "join" && n.callee.object.type === "CallExpression" && n.callee.object.callee.type === "MemberExpression" && !n.callee.object.callee.computed && n.callee.object.callee.property.name === "split") {
        growthOps++;
        const a = (n.callee.object.arguments as N[])[0];
        const b = args[0];
        const lit = (x: N | undefined) => (x?.type === "Literal" && typeof x.value === "string" ? (x.value as string) : undefined);
        const sa = lit(a);
        const sb = args.length === 0 ? "," : lit(b);
        if (sa === undefined || sb === undefined || sb.length > Math.max(sa.length, 1)) {
          add("no-resource-bomb", `split(a).join(b) must use string literals with b no longer than a (or one character); otherwise it lengthens the string and can be repeated into a memory bomb (heuristic check)`, n);
        }
      }
    }
  }
  if (growthOps > MAX_GROWTH_OPS) add("no-resource-bomb", `${growthOps} global replace / split-join calls; at most ${MAX_GROWTH_OPS} are allowed per script because each can lengthen a string and a chain of them compounds`);
}

/** Numeric array indexes above MAX_INDEX (a[4294967294] = 1 builds a sparse array that join() expands to gigabytes). */
export function checkIndexes(an: Analysis, add: AddFinding): void {
  for (const n of an.nodes) {
    if (n.type !== "MemberExpression" || !n.computed) continue;
    const v = an.fold(n.property);
    const num = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : undefined;
    if (num !== undefined && (!Number.isFinite(num) || num > MAX_INDEX)) {
      add("no-resource-bomb", `Numeric index ${String(v).slice(0, 20)} is above ${MAX_INDEX}; huge indexes make sparse arrays that join() or JSON.stringify expands to gigabytes`, n);
    }
  }
}

/** Direct and mutual recursion among functions declared in the script (a reference counts as a call, and a function reaches the functions nested in it). */
export function checkRecursion(an: Analysis, add: AddFinding): void {
  const edges = new Map<N, Set<N>>();
  const edge = (from: N, to: N) => (edges.get(from) ?? edges.set(from, new Set()).get(from)!).add(to);
  for (const n of an.nodes) {
    if (n.type === "FunctionExpression" || n.type === "FunctionDeclaration") {
      const outer = an.functionOf(n);
      if (outer !== an.program) edge(outer, n);
    }
    if (n.type === "Identifier") {
      const b = an.refBinding.get(n);
      const target = b ? an.localFunction(b) : undefined;
      if (target) {
        const from = an.functionOf(n);
        if (from !== an.program) edge(from, target);
      }
    }
  }
  const nameOf = (f: N) => (f.id?.name as string | undefined) ?? an.ownerOfFunction(f)?.name ?? "<anonymous function>";
  const state = new Map<N, 1 | 2>(); // 1 = on the stack, 2 = done
  const reported = new Set<N>();
  const visit = (f: N, path: N[]) => {
    state.set(f, 1);
    for (const g of edges.get(f) ?? []) {
      if (state.get(g) === 1) {
        const cycle = [...path.slice(path.indexOf(g)), g].map(nameOf);
        if (!reported.has(g)) {
          reported.add(g);
          add("no-recursion", `Recursion is forbidden (${cycle.join(" -> ")}): it can exhaust the stack. Rewrite it as a bounded for loop`, g);
        }
      } else if (!state.has(g)) visit(g, [...path, g]);
    }
    state.set(f, 2);
  };
  for (const f of edges.keys()) if (!state.has(f)) visit(f, [f]);
}

/**
 * Round 10: array-likes and sparse-array joins. Heuristic, named shapes only.
 *  - an object literal with a `length` property (the array-like for Array.prototype.slice.call({length: 1e9}));
 *  - join() whose separator is not a string literal of at most MAX_JOIN_SEPARATOR characters;
 *  - join() on a variable that is written at a numeric index above MAX_JOIN_INDEX or given a numeric length above it.
 */
export function checkArrayLikeAndJoin(an: Analysis, add: AddFinding): void {
  const sparse = new Set<Binding>();
  const num = (e: N | undefined): number | undefined => {
    const v = an.fold(e);
    return typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : undefined;
  };
  for (const n of an.nodes) {
    if (n.type === "ObjectExpression") {
      for (const p of n.properties as N[]) {
        const key = p.type === "Property" ? (p.computed ? an.fold(p.key) : p.key.type === "Identifier" ? p.key.name : p.key.value) : undefined;
        if (key === "length") add("no-resource-bomb", `An object literal with a "length" property is an array-like; Array.prototype.slice.call({length: 1e9}) allocates a huge array. Pass the result of querySelectorAll instead`, n);
      }
    }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && n.left.object.type === "Identifier") {
      const b = an.refBinding.get(n.left.object);
      if (!b) continue;
      if (n.left.computed) {
        const idx = num(n.left.property);
        if (idx !== undefined && idx > MAX_JOIN_INDEX) sparse.add(b);
      } else if (n.left.property.name === "length") {
        const len = num(n.right);
        if (len === undefined || len > MAX_JOIN_INDEX) sparse.add(b);
      }
    }
  }
  for (const n of an.nodes) {
    if (n.type !== "CallExpression" || n.callee.type !== "MemberExpression" || n.callee.computed || n.callee.property.name !== "join") continue;
    const arg = (n.arguments as N[])[0];
    if (arg !== undefined && !(arg.type === "Literal" && typeof arg.value === "string" && arg.value.length <= MAX_JOIN_SEPARATOR)) {
      add("no-resource-bomb", `join() must take no argument or a string literal of at most ${MAX_JOIN_SEPARATOR} characters; a computed or long separator multiplies the size of a sparse or large array (heuristic check)`, n);
    }
    if (n.callee.object.type === "Identifier") {
      const b = an.refBinding.get(n.callee.object);
      if (b && sparse.has(b)) add("no-resource-bomb", `"${b.name}" is written at a numeric index (or given a length) above ${MAX_JOIN_INDEX} and then joined; a sparse array makes join() build a huge string (heuristic check)`, n);
    }
  }
}
