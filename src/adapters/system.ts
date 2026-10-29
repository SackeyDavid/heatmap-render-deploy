import { PRIVATE_KEY_RE_ALL } from "../domain/secrets.ts";
import { randomBytes } from "node:crypto";
import type { Clock, IdGen, Logger } from "../ports/index.ts";

export const systemClock: Clock = { now: () => new Date() };

export const randomIdGen: IdGen = { next: (prefix) => `${prefix}-${randomBytes(4).toString("hex")}` };

export class FixedClock implements Clock {
  constructor(private readonly date = new Date("2026-10-26T12:00:00Z")) {}
  now(): Date {
    return this.date;
  }
}

export class SequentialIdGen implements IdGen {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `${prefix}-${this.n}`;
  }
}

/** Redacts anything shaped like a private Klaviyo key before it is logged. */
/** JSON that never throws: circular references and BigInt become strings, undefined fields are dropped. */
function safeStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(v ?? {}, (_k, val: unknown) => {
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}
const scrub = (v: unknown): unknown => JSON.parse(safeStringify(v).replace(PRIVATE_KEY_RE_ALL, "pk_[REDACTED]"));

export class ConsoleLogger implements Logger {
  constructor(private readonly quiet = false) {}
  private emit(level: string, message: string, fields?: Record<string, unknown>) {
    if (this.quiet) return;
    console.error(JSON.stringify({ level, ...(scrub({ message, ...fields }) as object) }));
  }
  info(m: string, f?: Record<string, unknown>) { this.emit("info", m, f); }
  warn(m: string, f?: Record<string, unknown>) { this.emit("warn", m, f); }
  error(m: string, f?: Record<string, unknown>) { this.emit("error", m, f); }
}

export class NullLogger implements Logger {
  info() {}
  warn() {}
  error() {}
}
