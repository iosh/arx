import type { AccountAddressCodec } from "../../accounts/accountAddressCodec.js";
import { createEip155AddressFormat } from "./address.js";

const addressFormat = createEip155AddressFormat();

export const eip155AccountAddressCodec: AccountAddressCodec = {
  namespace: "eip155",

  toAccountIdPayload({ chainRef, address }) {
    const { canonical } = addressFormat.canonicalize({ chainRef, value: address });
    return canonical.slice(2);
  },

  fromAccountIdPayload({ chainRef, payload }) {
    return addressFormat.canonicalize({ chainRef, value: `0x${payload}` }).canonical;
  },
};
