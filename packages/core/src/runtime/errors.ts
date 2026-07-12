import { ArxBaseError } from "../errors.js";

export type RuntimeHydrationErrorInput = {
  owner: string;
  resource: string;
  cause: unknown;
};

export class RuntimeHydrationError extends ArxBaseError {
  static readonly code = "runtime.hydration_failed";

  constructor(input: RuntimeHydrationErrorInput) {
    super(`Failed to hydrate ${input.owner} storage.`, {
      code: RuntimeHydrationError.code,
      details: {
        owner: input.owner,
        resource: input.resource,
      },
      cause: input.cause,
    });
  }
}

export type RuntimeLifecycleErrorInput = {
  label: string;
  operation: "start";
  required: "initialize";
};

export class RuntimeLifecycleError extends ArxBaseError {
  static readonly code = "runtime.lifecycle_invalid";

  constructor(input: RuntimeLifecycleErrorInput) {
    super("Runtime lifecycle operation is invalid.", {
      code: RuntimeLifecycleError.code,
      details: {
        label: input.label,
        operation: input.operation,
        required: input.required,
      },
    });
  }
}
