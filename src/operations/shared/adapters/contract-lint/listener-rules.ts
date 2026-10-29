// Listener accumulation: every addEventListener call must run once, at start-up. A registration inside another
// listener's callback adds listeners on every event (two per click doubles the handlers each time), and one inside a
// loop (or in a helper a loop calls) multiplies by the loop bound. Both are refused. Registration inside the "load"
// callback (start()) is the normal shape and is not counted as nested. HEURISTIC: it follows direct calls of local
// functions and lexical nesting; it cannot see a handler that re-registers itself through an element or the DOM.
import type { Node } from "acorn";
import type { Analysis } from "./script-rules.ts";
import { loopContext } from "./growth-flow.ts";

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes are walked structurally
type N = Node & Record<string, any>;

export function checkListeners(an: Analysis, eventType: (call: N) => string | undefined, add: (rule: string, message: string, node?: N) => void): void {
  const regs = an.nodes.filter((n) => n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.property.name === "addEventListener");
  if (regs.length === 0) return;
  const { inLoopContext, callTargets, callbackTargets } = loopContext(an);

  // Functions that run as a (non-load) event handler: registered with a type other than "load", plus everything nested in them or called from them.
  const handler = new Set<N>();
  for (const r of regs) {
    if (eventType(r) === "load") continue;
    const cb = (r.arguments as N[])[1];
    if (cb?.type === "FunctionExpression") handler.add(cb);
    else if (cb?.type === "Identifier") {
      const f = an.localFunction(an.refBinding.get(cb));
      if (f) handler.add(f);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of an.nodes) {
      const fn = an.functionOf(n);
      if (fn === an.program) continue;
      if (n.type === "FunctionExpression" || n.type === "FunctionDeclaration") {
        if (handler.has(fn) && !handler.has(n)) {
          handler.add(n);
          changed = true;
        }
      }
      if (n.type === "CallExpression" && handler.has(fn)) {
        for (const f of [callTargets(n), ...callbackTargets(n)]) {
          if (f && !handler.has(f)) {
            handler.add(f);
            changed = true;
          }
        }
      }
    }
  }
  const insideHandler = (node: N): boolean => {
    for (let f: N | undefined = an.functionOf(node); f && f !== an.program; f = an.functionOf(f)) if (handler.has(f)) return true;
    return false;
  };

  for (const r of regs) {
    if (insideHandler(r)) add("no-listener-accumulation", "addEventListener is called inside an event handler (or a helper a handler calls): every event would add another listener, and two registrations per event double them each time. Register listeners once, in start()", r);
    else if (inLoopContext(r)) add("no-listener-accumulation", "addEventListener is called inside a loop or forEach callback (or a helper called from one): that registers one listener per pass and can attach thousands. Delegate from document instead: one click listener that checks event.target", r);
  }
}
