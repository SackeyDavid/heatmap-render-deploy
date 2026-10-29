import { InvalidInputError, UnknownOperationError } from "../domain/errors.ts";
import { JOB_ID_RE } from "../domain/job-id.ts";
import type { Job, StepSpec } from "../domain/types.ts";
import type { AgenticOperation, IdGen, JobHandle, Logger, Pipeline, RunOperation } from "../ports/index.ts";

export interface RegisteredOperation {
  operation: AgenticOperation<unknown>;
  steps: StepSpec[];
}

/** The driving port implementation: validates input, then runs the named operation. */
export class OperationService implements RunOperation {
  constructor(
    private readonly operations: Map<string, RegisteredOperation>,
    private readonly pipeline: Pipeline,
    private readonly idGen: IdGen,
    private readonly logger: Logger,
  ) {}

  async run(request: { operation: string; input: unknown; jobId?: string }): Promise<JobHandle> {
    const registered = this.operations.get(request.operation);
    if (!registered) throw new UnknownOperationError(request.operation);

    let input: unknown;
    try {
      input = registered.operation.inputSchema.parse(request.input);
    } catch (e) {
      throw new InvalidInputError(e instanceof Error ? e.message : String(e));
    }

    if (request.jobId !== undefined && !JOB_ID_RE.test(request.jobId)) {
      throw new InvalidInputError("job id must be letters, digits, dots, underscores or hyphens (no slashes)");
    }
    const jobId = request.jobId ?? this.idGen.next("job");
    this.logger.info("operation accepted", { operation: request.operation, jobId });
    const done: Promise<Job> = registered.operation
      .execute(input, { jobId, steps: registered.steps, pipeline: this.pipeline, logger: this.logger })
      .then((r) => r.job);
    return { jobId, done };
  }
}
