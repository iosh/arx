import type { ChainRef } from "../chains/ids.js";
import { AccountAddressCodecNotFoundError } from "./errors.js";

export type AccountAddressCodec = {
  namespace: string;

  toAccountIdPayload(params: { chainRef: ChainRef; address: string }): string;
  fromAccountIdPayload(params: { chainRef: ChainRef; payload: string }): string;
};

export type AccountAddressCodecs = ReadonlyMap<string, AccountAddressCodec>;

export const getAccountAddressCodec = (codecs: AccountAddressCodecs, namespace: string): AccountAddressCodec => {
  const codec = codecs.get(namespace);
  if (codec) return codec;
  throw new AccountAddressCodecNotFoundError({ namespace });
};
