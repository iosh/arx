import { Hex, PersonalMessage } from "ox";
import { invalidDappParams } from "../../dappConnections/defineDappMethod.js";
import { parseAddress } from "./address.js";
import { addHexPrefix } from "./hexPrefix.js";
import type { Eip155PersonalMessage } from "./signingRequest.js";

const decodePersonalMessage = (value: string, method: string): Eip155PersonalMessage => {
  const hex = value.replace(/^(?:0x)?/i, "0x");

  if (value.length > 0 && Hex.validate(hex, { strict: true })) {
    if (hex.length % 2 !== 0) throw invalidDappParams(method, "message must contain complete hexadecimal bytes.");
    return { format: "hex", value: hex };
  }

  return { format: "utf8", value };
};

export const decodePersonalSignParams = (params: unknown, method: string) => {
  if (!Array.isArray(params) || params.length < 2) {
    throw invalidDappParams(method, "expected a message and address.");
  }

  const first = params[0];
  const second = params[1];
  if (typeof first !== "string" || typeof second !== "string") {
    throw invalidDappParams(method, "message and address must be strings.");
  }

  const secondAddress = parseAddress(addHexPrefix(second));
  const address = secondAddress ?? parseAddress(addHexPrefix(first));
  if (address === null) {
    throw invalidDappParams(method, "expected a valid EIP-155 account address.");
  }

  const message = secondAddress === null ? second : first;
  return { address, message: decodePersonalMessage(message, method) };
};

export const personalMessageDigest = (message: Eip155PersonalMessage): Hex.Hex => {
  const value = message.format === "hex" ? message.value : Hex.fromString(message.value);
  return PersonalMessage.getSignPayload(value);
};
