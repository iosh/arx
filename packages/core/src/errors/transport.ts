import { ArxBaseError } from "../error.js";

export class TransportDisconnectedError extends ArxBaseError {
  static readonly code = "global.transport.disconnected";

  constructor(message = "Transport disconnected.") {
    super(message, {
      code: TransportDisconnectedError.code,
    });
  }
}
