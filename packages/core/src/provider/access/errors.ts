import { ArxBaseError } from "../../errors.js";

export type InvalidProviderConnectionScopeInput = {
  field: "origin" | "namespace";
  message?: string;
};

export class InvalidProviderConnectionScopeError extends ArxBaseError {
  static readonly code = "provider.connection_scope.invalid";

  constructor(input: InvalidProviderConnectionScopeInput) {
    super(input.message ?? `Invalid provider connection scope ${input.field}.`, {
      code: InvalidProviderConnectionScopeError.code,
      details: { field: input.field },
    });
  }
}

export class ProviderRequestCancellationError extends ArxBaseError {
  static readonly code = "provider.request_cancellation_failed";

  constructor(rejectionCount: number) {
    super("Failed to cancel provider requests.", {
      code: ProviderRequestCancellationError.code,
      details: { rejectionCount },
    });
  }
}

export class ProviderDisconnectedError extends ArxBaseError {
  static readonly code = "provider.disconnected";

  constructor(message = "Provider disconnected.") {
    super(message, {
      code: ProviderDisconnectedError.code,
    });
  }
}
