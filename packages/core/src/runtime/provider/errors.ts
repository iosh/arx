import { ArxBaseError, type ErrorCause } from "../../error.js";

export type InvalidProviderConnectionScopeInput = ErrorCause & {
  field: "origin" | "namespace";
  message?: string;
};

export class InvalidProviderConnectionScopeError extends ArxBaseError {
  static readonly code = "provider.connection_scope.invalid";

  constructor(input: InvalidProviderConnectionScopeInput) {
    super(input.message ?? `Invalid provider connection scope ${input.field}.`, {
      code: InvalidProviderConnectionScopeError.code,
      details: { field: input.field },
      cause: input.cause,
    });
  }
}

export type TransportDisconnectedInput = ErrorCause & {
  message?: string;
};

export class TransportDisconnectedError extends ArxBaseError {
  static readonly code = "global.transport.disconnected";

  constructor(input: TransportDisconnectedInput = {}) {
    super(input.message ?? "Transport disconnected.", {
      code: TransportDisconnectedError.code,
      cause: input.cause,
    });
  }
}
