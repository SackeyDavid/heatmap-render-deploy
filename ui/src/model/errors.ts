export class ModelUnavailable extends Error {
  readonly code = "ModelUnavailable" as const;
  constructor(message: string, readonly reason?: string) {
    super(message);
    this.name = "ModelUnavailable";
  }
}

export class ModelTimeout extends Error {
  readonly code = "ModelTimeout" as const;
  constructor(message = "The helper took too long.") {
    super(message);
    this.name = "ModelTimeout";
  }
}

export class ModelAborted extends Error {
  readonly code = "ModelAborted" as const;
  constructor(message = "Cancelled.") {
    super(message);
    this.name = "ModelAborted";
  }
}

export class ModelOutputTooLong extends Error {
  readonly code = "ModelOutputTooLong" as const;
  constructor(message = "The helper returned too much text.") {
    super(message);
    this.name = "ModelOutputTooLong";
  }
}

export type ModelError = ModelUnavailable | ModelTimeout | ModelAborted | ModelOutputTooLong;

export type ModelUnusable =
  | "no-webgpu"
  | "no-assets"
  | "no-space"
  | "load-failed"
  | "timeout"
  | "unsupported";
