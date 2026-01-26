import * as Hex from "ox/Hex";

export const sanitizePrivateKeyInput = (value: string) => value.trim().replace(/[\s,]+/g, "");

export const formatPrivateKeyHex = (value: string) => {
  const sanitized = sanitizePrivateKeyInput(value);
  if (!sanitized) return "";
  return sanitized.startsWith("0x") ? sanitized : `0x${sanitized}`;
};

export const isValidPrivateKey = (value: string) => {
  const hex = formatPrivateKeyHex(value).toLowerCase();
  if (!hex) return false;
  try {
    const bytes = Hex.toBytes(hex as Hex.Hex);
    return bytes.length === 32 && hex.length === 66;
  } catch {
    return false;
  }
};
