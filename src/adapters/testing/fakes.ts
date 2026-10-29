import type { QaReport, VerificationResult } from "../../domain/types.ts";
import type { QaInput, QualityGate, Verifier } from "../../ports/index.ts";

/** Fake QualityGate: returns a fixed outcome. `errors` are turned into error findings, `warnings` into warnings. */
export class StaticGate implements QualityGate {
  readonly calls: QaInput[] = [];

  constructor(
    readonly name = "static.gate",
    private readonly outcome: { errors?: string[]; warnings?: string[] } = {},
  ) {}

  async review(input: QaInput): Promise<QaReport> {
    this.calls.push(input);
    const findings = [
      ...(this.outcome.errors ?? []).map((message) => ({ gate: this.name, rule: "static", severity: "error" as const, message })),
      ...(this.outcome.warnings ?? []).map((message) => ({ gate: this.name, rule: "static", severity: "warn" as const, message })),
    ];
    return { passed: !findings.some((f) => f.severity === "error"), findings };
  }
}

/** Fake Verifier: returns a fixed result and records what it was asked to verify. */
export class FixedVerifier implements Verifier {
  readonly calls: { jobId: string; files: string[] }[] = [];

  constructor(private readonly outcome: { ok: boolean; problems?: string[]; question?: string; details?: Record<string, string> } = { ok: true }) {}

  async verify(args: { jobId: string; files: Record<string, string> }): Promise<VerificationResult> {
    this.calls.push({ jobId: args.jobId, files: Object.keys(args.files) });
    return {
      ok: this.outcome.ok,
      problems: this.outcome.ok ? [] : (this.outcome.problems ?? ["fixed verifier says no"]),
      ...(this.outcome.question ? { question: this.outcome.question } : {}),
      details: this.outcome.details ?? {},
    };
  }
}
