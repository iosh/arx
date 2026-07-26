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
