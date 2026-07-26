import { Hex, PersonalMessage } from "ox";
import { invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import { isEip155Address } from "./address.js";
import type { Eip155PersonalMessage } from "./signingRequest.js";

const decodePersonalMessage = (value: string): Eip155PersonalMessage => {
  const hasPrefix = value.startsWith("0x") || value.startsWith("0X");
  const body = hasPrefix ? value.slice(2) : value;
  const hex = `0x${body}`;

  if (body.length > 0 && Hex.validate(hex, { strict: true })) {
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

  const legacyOrder = isEip155Address(first) && !isEip155Address(second);
  const address = legacyOrder ? first : second;
  const message = legacyOrder ? second : first;
  if (!isEip155Address(address)) {
    throw invalidDappParams(method, "expected a valid EIP-155 account address.");
  }

  return { address, message: decodePersonalMessage(message) };
};

export const personalMessageDigest = (message: Eip155PersonalMessage): Hex.Hex => {
  const value = message.format === "hex" ? message.value : Hex.fromString(message.value);
  return PersonalMessage.getSignPayload(value);
};
