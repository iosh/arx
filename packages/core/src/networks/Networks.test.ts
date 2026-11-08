import { describe, expect, it, vi } from "vitest";
import { ChainJsonRpcHttpTransportError, type JsonRpcHttpTransport } from "../chainJsonRpc/JsonRpcHttpTransport.js";
import { createEip155NetworksAdapter } from "../namespaces/eip155/networks.js";
import type { PersistenceWriter } from "../persistence/corePersistence.js";
import { PersistenceCommitError } from "../persistence/errors.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import {
  CustomNetworkAlreadyExistsError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointReadError,
} from "./errors.js";
import { Networks } from "./Networks.js";
import type { CustomNetworkRecord } from "./persistence.js";
import type { NetworksChanged } from "./types.js";

const custom: CustomNetworkRecord = {
  definition: {
    chainRef: "eip155:8453",
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: ["https://base.example", "https://base-backup.example"],
};

const createFixture = (customNetworks: readonly CustomNetworkRecord[] = []) => {
  const request = vi.fn<JsonRpcHttpTransport["request"]>().mockResolvedValue("0x2105");
  const commit = vi.fn<PersistenceWriter["commit"]>().mockResolvedValue(undefined);
  const changes: NetworksChanged[] = [];
  const networks = new Networks({
    adapters: [createEip155NetworksAdapter({ transport: { request: request as JsonRpcHttpTransport["request"] } })],
    bootstrap: { customNetworks, networkRpcOverrides: [] },
    mutations: createCoreMutationQueue({ commit }),
    publishChanged: (change) => changes.push(change),
  });

  return { networks, commit, changes, request };
};

describe("Networks", () => {
  it("saves an added network and its updated metadata and RPC configuration", async () => {
    const { networks, commit } = createFixture();
    await networks.addCustom(custom);
    const updated = {
      definition: { ...custom.definition, name: "Base Mainnet" },
      defaultRpcEndpoints: ["https://base-v2.example"],
    } as const;
    await networks.updateCustom(updated);
    expect(networks.get(custom.definition.chainRef)).toMatchObject({ ...updated.definition, source: "custom" });
    expect(networks.getRpcConfiguration(custom.definition.chainRef)).toEqual({
      source: "default",
      endpoints: updated.defaultRpcEndpoints,
    });
    expect(commit).toHaveBeenLastCalledWith([{ persistenceType: "customNetwork", operation: "put", value: updated }]);
  });

  it("saves testnet marking changes once without rechecking unchanged RPC endpoints", async () => {
    const { networks, commit, changes, request } = createFixture([custom]);
    const testnet = { ...custom, definition: { ...custom.definition, isTestnet: true } };
    await networks.updateCustom(testnet);
    await networks.updateCustom(testnet);
    expect(networks.get(custom.definition.chainRef)).toMatchObject({ isTestnet: true });
    expect(commit).toHaveBeenCalledExactlyOnceWith([
      { persistenceType: "customNetwork", operation: "put", value: testnet },
    ]);
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: [custom.definition.chainRef] }]);

    const unmarked = { ...custom, definition: { ...custom.definition, isTestnet: false } };
    await networks.updateCustom(unmarked);
    expect(networks.get(custom.definition.chainRef)).toMatchObject({ isTestnet: false });
    expect(commit).toHaveBeenLastCalledWith([{ persistenceType: "customNetwork", operation: "put", value: unmarked }]);
    expect(changes).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();
  });

  it("admits only one of two concurrent additions of the same chain", async () => {
    const { networks, commit, changes } = createFixture();
    await expect(Promise.all([networks.addCustom(custom), networks.addCustom(custom)])).rejects.toBeInstanceOf(
      CustomNetworkAlreadyExistsError,
    );
    expect(networks.get(custom.definition.chainRef)).toMatchObject(custom.definition);
    expect(commit).toHaveBeenCalledOnce();
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: [custom.definition.chainRef] }]);
  });

  it("sets and clears RPC overrides only when configuration changes", async () => {
    const { networks, commit, changes, request } = createFixture();
    request.mockResolvedValue("0x1");
    const defaultEndpoints = networks.getRpcEndpoints("eip155:1");
    const endpoints = ["https://ethereum-override.example"] as const;
    await networks.setRpcOverride({ chainRef: "eip155:1", endpoints });
    await networks.setRpcOverride({ chainRef: "eip155:1", endpoints });
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "override",
      endpoints,
      defaultEndpoints,
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: ["eip155:1"] }]);
    expect(request).toHaveBeenCalledOnce();

    commit.mockClear();
    await networks.clearRpcOverride("eip155:1");
    await networks.clearRpcOverride("eip155:1");
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "default",
      endpoints: defaultEndpoints,
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith([
      { persistenceType: "networkRpcOverride", operation: "remove", key: "eip155:1" },
    ]);
    expect(changes).toHaveLength(2);
  });

  it("requires the backup RPC to identify the requested chain before saving", async () => {
    const mismatch = createFixture();
    mismatch.request.mockResolvedValueOnce("0x2105").mockResolvedValue("0x1");
    await expect(mismatch.networks.addCustom(custom)).rejects.toThrow(NetworkRpcEndpointMismatchError);
    expect(mismatch.networks.get("eip155:8453")).toBeNull();
    expect(mismatch.commit).not.toHaveBeenCalled();
    expect(mismatch.changes).toEqual([]);
  });

  it.each(["unavailable", "invalid response"])("rejects an %s RPC without installing the network", async (failure) => {
    const unavailable = createFixture();
    if (failure === "unavailable") {
      unavailable.request.mockRejectedValue(new ChainJsonRpcHttpTransportError("RPC request failed."));
    } else {
      unavailable.request.mockResolvedValue(null);
    }
    await expect(unavailable.networks.addCustom(custom)).rejects.toBeInstanceOf(NetworkRpcEndpointReadError);
    expect(unavailable.networks.get("eip155:8453")).toBeNull();
    expect(unavailable.commit).not.toHaveBeenCalled();
    expect(unavailable.changes).toEqual([]);
  });

  it("does not install or publish a network when persistence fails", async () => {
    const commitFailure = new PersistenceCommitError(new DOMException("Transaction aborted", "AbortError"));
    const failedCommit = createFixture();
    failedCommit.commit.mockRejectedValue(commitFailure);
    await expect(failedCommit.networks.addCustom(custom)).rejects.toBe(commitFailure);
    expect(failedCommit.networks.get("eip155:8453")).toBeNull();
    expect(failedCommit.changes).toEqual([]);
  });
});
