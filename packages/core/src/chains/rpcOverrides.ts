import type { ChainRef } from "../networks/chainRef.js";
import type { RpcEndpoint } from "../networks/types.js";
import { persistenceChange } from "../persistence/change.js";
import { ChainNotFoundError } from "./errors.js";
import type { NetworksContext } from "./networks.js";
import { chainRpcOverridePersistenceType } from "./persistence.js";
import { assertNonEmptyRpcEndpoints } from "./rpc/config.js";

export const setRpcOverride = async (
  networks: NetworksContext,
  params: { chainRef: ChainRef; endpoints: readonly RpcEndpoint[] },
): Promise<void> => {
  const record = {
    chainRef: params.chainRef,
    endpoints: assertNonEmptyRpcEndpoints(params.chainRef, params.endpoints),
  };
  await networks.mutations.run(async (commit) => {
    if (!networks.definitions.get(params.chainRef)) throw new ChainNotFoundError();
    await commit([persistenceChange.put(chainRpcOverridePersistenceType, record)]);
    networks.rpc.replaceOverride(record);
    networks.publishChanged({ rpc: [params.chainRef] });
  });
};

export const clearRpcOverride = async (networks: NetworksContext, chainRef: ChainRef): Promise<void> => {
  await networks.mutations.run(async (commit) => {
    if (!networks.rpc.getOverride(chainRef)) return;
    await commit([persistenceChange.remove(chainRpcOverridePersistenceType, chainRef)]);
    networks.rpc.removeOverride(chainRef);
    networks.publishChanged({ rpc: [chainRef] });
  });
};
