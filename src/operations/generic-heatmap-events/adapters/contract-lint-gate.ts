import type { Finding, QaReport } from "../../../domain/types.ts";
import type { QaInput, QualityGate } from "../../../ports/index.ts";
import {
  ContractLintGate,
  DEFAULT_LINT_OPTIONS,
  makeFireCustomEventTransport,
} from "../../shared/adapters/contract-lint/contract-lint.ts";

export const GENERIC_LINT_GATE_NAME = "generic.heatmap-events.contract-lint";

function destinationFromContext(context: Record<string, unknown>): string | null {
  const dest = String(context.partnerDestination ?? "").trim();
  return dest.length > 0 ? dest : null;
}

/** Contract lint with per-job partner destination (window._fireCustomEvent second argument). */
export class GenericHeatmapEventsLintGate implements QualityGate {
  readonly name = GENERIC_LINT_GATE_NAME;

  private gateFor(context: Record<string, unknown>): ContractLintGate | null {
    const dest = destinationFromContext(context);
    if (!dest) return null;
    return new ContractLintGate({
      ...DEFAULT_LINT_OPTIONS,
      transport: makeFireCustomEventTransport(dest),
      gateName: GENERIC_LINT_GATE_NAME,
    });
  }

  async review(input: QaInput): Promise<QaReport> {
    const gate = this.gateFor(input.context);
    if (!gate) {
      const findings: Finding[] = [
        {
          gate: this.name,
          rule: "missing-partner-destination",
          severity: "error",
          message: "Partner destination was missing from the job context, so the script could not be checked.",
        },
      ];
      return { passed: false, findings };
    }
    return gate.review(input);
  }

  async reviewPublished(input: QaInput): Promise<QaReport> {
    const gate = this.gateFor(input.context);
    if (!gate) {
      return { passed: false, findings: [{ gate: this.name, rule: "missing-partner-destination", severity: "error", message: "Partner destination missing" }] };
    }
    return gate.reviewPublished(input);
  }
}
