import { ArxBaseError } from "../errors.js";

export class DappOriginInvalidError extends ArxBaseError {
  static readonly code = "dapp.origin_invalid";

  constructor(sourceUrl: string) {
    super("Dapp URL must have an HTTP or HTTPS origin.", {
      code: DappOriginInvalidError.code,
      details: { sourceUrl },
    });
  }
}
