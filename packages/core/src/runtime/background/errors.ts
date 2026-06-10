import { ArxBaseError, type ErrorCause } from "../../error.js";

export type RuntimeHydrationErrorInput = ErrorCause & {
  owner: string;
  resource: string;
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
