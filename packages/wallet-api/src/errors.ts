import type { ArxErrorDetails } from "@arx/core";

export type SerializedWalletApiError = Readonly<{
  code: string;
  message: string;
  details?: ArxErrorDetails;
}>;

export type WalletApiErrorInput = Readonly<{
  code: string;
  message: string;
  details?: ArxErrorDetails;
  cause?: unknown;
}>;

export class WalletApiError extends Error {
  readonly code: string;
  readonly details: ArxErrorDetails | undefined;

  constructor(input: WalletApiErrorInput) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = new.target.name;
    this.code = input.code;
    this.details = input.details;
  }
}

/** Matches the definition's code; the received error remains a WalletApiError. */
export function isWalletApiError(error: unknown, expected: { readonly code: string }): error is WalletApiError {
  return error instanceof WalletApiError && error.code === expected.code;
}

export class WalletChannelDisconnectedError extends WalletApiError {
  static readonly code = "wallet_api.channel_disconnected";

  constructor(cause?: unknown) {
    super({
      code: WalletChannelDisconnectedError.code,
      message: "The wallet channel is disconnected.",
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
