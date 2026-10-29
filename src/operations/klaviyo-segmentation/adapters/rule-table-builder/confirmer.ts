import type { ConfirmOutcome } from "../../../../ports/index.ts";
import type { KlaviyoConfirmArgs, KlaviyoConfirmer } from "../../ports.ts";
import { confirmKlaviyo } from "./understanding.ts";

/** The deterministic confirm adapter: validates a model's interpretation against the page and summarises it for the merchant. No model, no network. */
export class RuleTableConfirmer implements KlaviyoConfirmer {
  confirm(args: KlaviyoConfirmArgs): ConfirmOutcome {
    return confirmKlaviyo(args);
  }
}
