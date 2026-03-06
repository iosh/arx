import { ArxReasons, arxError } from "@arx/errors";
import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../rpc/namespaceClients/eip155.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { assertUnlocked } from "./lib.js";

export const createBalancesHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers" | "session" | "rpcClients">,
): Pick<UiHandlers, "ui.balances.getNative"> => {
  return {
    "ui.balances.getNative": async ({ chainRef, address }) => {
      assertUnlocked(deps.session);
      const chain = deps.controllers.network.getChain(chainRef);
      if (!chain) {
        throw arxError({ reason: ArxReasons.ChainNotFound, message: `Unknown chain: ${chainRef}` });
      }

      if (chain.namespace !== "eip155") {
        throw arxError({
          reason: ArxReasons.ChainNotSupported,
          message: `Native balance is not supported for namespace "${chain.namespace}" yet.`,
          data: { chainRef, namespace: chain.namespace },
        });
      }

      const rpc = deps.rpcClients.getClient<Eip155RpcCapabilities>("eip155", chainRef);
      const balanceHex = await rpc.getBalance(address, { blockTag: "latest", timeoutMs: 15_000 });
      Hex.assert(balanceHex as Hex.Hex, { strict: false });
      const amountWei = Hex.toBigInt(balanceHex as Hex.Hex);

      return { chainRef, address, amountWei: amountWei.toString(10), fetchedAt: Date.now() };
    },
  };
};
