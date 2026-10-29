export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

export class UnknownOperationError extends Error {
  constructor(operation: string) {
    super(`Unknown operation "${operation}"`);
    this.name = "UnknownOperationError";
  }
}

/** Raised by a step when the job cannot continue; becomes a failure email, not a crash. */
export class StepFailure extends Error {
  constructor(
    message: string,
    readonly question?: string,
    /** Stable name of what went wrong, for code that must tell failures apart (never match on `message`). */
    readonly code?: string,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

/** Raised at startup when the manifest and the adapter registry disagree. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

/** A stored job record that cannot be read (for example a file cut short by a crash mid-write). */
export class CorruptJobError extends Error {
  constructor(readonly jobId: string) {
    super(`The stored record for job ${jobId} is unreadable`);
    this.name = "CorruptJobError";
  }
}

/** StepFailure.code for a failure whose `question` came from the agent's own `question` field (a vetted, bounded refusal text). */
export const AGENT_QUESTION_CODE = "agent-question";
/** A failure code (not a public one): the server-side reader could not give a usable answer, so a client may read the words itself and send them again. */
export const READER_UNAVAILABLE_CODE = "reader-unavailable";

/** Thrown by a step to pause the job until the requester approves (job status "awaiting-approval"); not a failure. */
export class AwaitingApproval extends Error {
  constructor() {
    super("awaiting approval");
    this.name = "AwaitingApproval";
  }
}

/** StepFailure.code when the pages changed between the requester's approval and the build. */
export const PAGE_CHANGED_CODE = "page-changed";
