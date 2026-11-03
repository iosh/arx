import { Accounts } from "../../../accounts/Accounts.js";
import { createJsonRpcHttpTransport } from "../../../chainJsonRpc/JsonRpcHttpTransport.js";
import { Networks } from "../../../networks/Networks.js";
import { createCoreMutationQueue } from "../../../persistence/mutationQueue.js";
import { eip155AccountsAdapter } from "../accounts.js";
import { createEip155NetworksAdapter } from "../networks.js";

export const PRIVATE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const ACCOUNT_ID = "eip155:fcad0b19bb29d4674531d6f115237e16afce377c";
export const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
export const KEY_SOURCE_ID = "source-1";

export const createAccounts = () =>
  new Accounts({
    adapters: { eip155: eip155AccountsAdapter },
    bootstrap: {
      groups: [
        {
          accountGroupId: "group-1",
          source: { type: "private-key", keySourceId: KEY_SOURCE_ID },
          hidden: false,
          createdAt: 1,
        },
        {
          accountGroupId: "group-2",
          source: { type: "private-key", keySourceId: "source-2" },
          hidden: false,
          createdAt: 2,
        },
      ],
      records: [
        {
          accountId: ACCOUNT_ID,
          accountGroupId: "group-1",
          origin: { type: "private-key", keySourceId: KEY_SOURCE_ID },
        },
        {
          accountId: "eip155:7e5f4552091a69125d5dfcb7b8c2659029395bdf",
          accountGroupId: "group-2",
          origin: { type: "private-key", keySourceId: "source-2" },
        },
      ],
      selection: { accountGroupId: "group-2" },
    },
    mutations: createCoreMutationQueue({ commit: async () => {} }),
    publishChanged: () => {},
  });

export const createNetworks = () =>
  new Networks({
    adapters: [createEip155NetworksAdapter({ transport: createJsonRpcHttpTransport() })],
    bootstrap: { customNetworks: [], networkRpcOverrides: [] },
    mutations: createCoreMutationQueue({ commit: async () => {} }),
    publishChanged: () => {},
  });
