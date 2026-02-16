import { ArxReasons, arxError } from "@arx/errors";

export const chainErrors = {
  invalidAddress: (namespace: string, data?: Record<string, unknown>) =>
    arxError({
      reason: ArxReasons.ChainInvalidAddress,
      message: `Invalid ${namespace} address`,
      ...(data ? { data } : {}),
    }),
};
