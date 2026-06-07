import { RpcInvalidParamsError } from "../../../errors.js";

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const parseEip155PersonalSignParams = (params: readonly unknown[]) => {
  const address = params.find((value): value is string => typeof value === "string" && HEX_ADDRESS_PATTERN.test(value));
  const message = params.find((value): value is string => typeof value === "string" && (!address || value !== address));
  return { address, message };
};

export const parseEip155TypedDataParams = (params: readonly unknown[]) => {
  let address: string | undefined;
  let payload: unknown;

  for (const value of params) {
    if (!address && typeof value === "string" && HEX_ADDRESS_PATTERN.test(value)) {
      address = value;
      continue;
    }

    if (payload === undefined) {
      payload = value;
    }
  }

  if (!address || payload === undefined) {
    throw new RpcInvalidParamsError({
      message: "eth_signTypedData_v4 expects an address and typed data payload",
    });
  }

  if (typeof payload === "string") {
    return { address, typedData: payload };
  }

  try {
    return { address, typedData: JSON.stringify(payload) };
  } catch (error) {
    throw new RpcInvalidParamsError({
      message: "Failed to serialise typed data payload",
      cause: error,
    });
  }
};
