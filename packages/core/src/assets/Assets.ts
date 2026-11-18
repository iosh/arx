import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../networks/chainRef.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import type { AssetsNamespaceAdapters } from "./namespaceAdapter.js";
import type { AssetBalance } from "./types.js";

export type Assets = Readonly<{
  /** Reads current on-chain balances using a public account identity. */
  getBalances(input: { accountId: AccountId; chainRef: ChainRef }): Promise<readonly AssetBalance[]>;
}>;

type AssetsOptions = Readonly<{
  accounts: Pick<Accounts, "getAddress">;
  networks: Pick<NetworksReader, "get">;
  adapters: AssetsNamespaceAdapters;
}>;

export const createAssets = ({ accounts, networks, adapters }: AssetsOptions): Assets => ({
  async getBalances(input) {
    const network = networks.get(input.chainRef);
    if (!network) throw new NetworkNotFoundError(input.chainRef);

    const adapter = adapters[network.namespace];
    if (!adapter) throw new Error(`Assets are not configured for namespace "${network.namespace}".`);

    const { canonicalAddress } = accounts.getAddress(input);
    return adapter.getBalances({ network, address: canonicalAddress });
  },
});
