import { ArxBaseError, type ErrorCause } from "../error.js";

export class WalletMethodBindingInvariantError extends ArxBaseError {
  static readonly code = "wallet.method.binding_invariant";

  constructor(input: ErrorCause & { path: string; message?: string }) {
    super(input.message ?? `Wallet method binding invariant failed for "${input.path}".`, {
      code: WalletMethodBindingInvariantError.code,
      details: { path: input.path },
      cause: input.cause,
    });
  }
}
