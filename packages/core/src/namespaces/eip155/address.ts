import { Address } from "ox";

export const parseAddress = (value: string): Address.Address | null => {
  const address = value.toLowerCase();
  return Address.validate(address, { strict: false }) ? address : null;
};
