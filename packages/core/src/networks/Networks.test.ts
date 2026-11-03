import { describe, expect, it, vi } from "vitest";
import { ChainJsonRpcHttpTransportError, type JsonRpcHttpTransport } from "../chainJsonRpc/JsonRpcHttpTransport.js";
import { createEip155NetworksAdapter } from "../namespaces/eip155/networks.js";
import type { PersistenceWriter } from "../persistence/corePersistence.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import {
  BuiltinNetworkConflictError,
  BuiltinNetworkImmutableError,
  CustomNetworkAlreadyExistsError,
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointVerificationError,
} from "./errors.js";
import { Networks } from "./Networks.js";
import type { CustomNetworkRecord } from "./persistence.js";
import type { NetworksChanged, NonEmptyRpcEndpoints } from "./types.js";

const custom: CustomNetworkRecord = {
  definition: {
    chainRef: "eip155:8453",
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: ["https://base.example", "https://base-backup.example"],
};

const createFixture = () => {
  const request = vi.fn<JsonRpcHttpTransport["request"]>().mockResolvedValue("0x2105");
  const commit = vi.fn<PersistenceWriter["commit"]>().mockResolvedValue(undefined);
  const changes: NetworksChanged[] = [];
  const networks = new Networks({
    adapters: [createEip155NetworksAdapter({ transport: { request: request as JsonRpcHttpTransport["request"] } })],
    bootstrap: { customNetworks: [], networkRpcOverrides: [] },
    mutations: createCoreMutationQueue({ commit }),
    publishChanged: (change) => changes.push(change),
  });

  return { networks, commit, changes, request };
};

describe("Networks", () => {
  it("adds and updates custom networks without writing or publishing unchanged configuration", async () => {
    const { networks, commit, changes, request } = createFixture();

    await networks.addCustom(custom);
    expect(networks.get("eip155:8453")).toMatchObject({ name: "Base", source: "custom" });
    expect(commit).toHaveBeenCalledWith([{ persistenceType: "customNetwork", operation: "put", value: custom }]);
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: ["eip155:8453"] }]);
    expect(request).toHaveBeenCalledTimes(2);

    await expect(networks.addCustom(custom)).rejects.toThrow(CustomNetworkAlreadyExistsError);
    await expect(
      networks.addCustom({ ...custom, definition: { ...custom.definition, chainRef: "eip155:1" } }),
    ).rejects.toThrow(BuiltinNetworkConflictError);
    await networks.updateCustom(custom);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(changes).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);

    const updated = {
      definition: { ...custom.definition, name: "Base Mainnet" },
      defaultRpcEndpoints: ["https://base-v2.example"],
    } as const;
    await networks.updateCustom(updated);
    expect(networks.get("eip155:8453")).toMatchObject({ name: "Base Mainnet" });
    expect(networks.getRpcEndpoints("eip155:8453")).toEqual(updated.defaultRpcEndpoints);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(changes).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(3);

    await expect(
      networks.updateCustom({ ...custom, definition: { ...custom.definition, chainRef: "eip155:1" } }),
    ).rejects.toThrow(BuiltinNetworkImmutableError);
  });

  it("sets and clears RPC overrides only when configuration changes", async () => {
    const { networks, commit, changes, request } = createFixture();
    request.mockResolvedValue("0x1");
    const defaultEndpoints = networks.getRpcEndpoints("eip155:1");
    const endpoints: NonEmptyRpcEndpoints = ["https://ethereum-override.example"];

    await networks.setRpcOverride({ chainRef: "eip155:1", endpoints });
    await networks.setRpcOverride({ chainRef: "eip155:1", endpoints });
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "override",
      endpoints,
      defaultEndpoints,
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: ["eip155:1"] }]);
    expect(request).toHaveBeenCalledTimes(1);

    await networks.clearRpcOverride("eip155:1");
    await networks.clearRpcOverride("eip155:1");
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "default",
      endpoints: defaultEndpoints,
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith([
      { persistenceType: "networkRpcOverride", operation: "remove", key: "eip155:1" },
    ]);
    expect(changes).toHaveLength(2);
  });

  it("keeps a network inactive when an endpoint is invalid, a backup has the wrong chain, or saving fails", async () => {
    const invalid = createFixture();
    await expect(invalid.networks.addCustom({ ...custom, defaultRpcEndpoints: ["ws://base.example"] })).rejects.toThrow(
      NetworkRpcEndpointInvalidError,
    );
    expect(invalid.request).not.toHaveBeenCalled();
    expect(invalid.commit).not.toHaveBeenCalled();

    const mismatch = createFixture();
    mismatch.request.mockResolvedValueOnce("0x2105").mockResolvedValue("0x1");
    await expect(mismatch.networks.addCustom(custom)).rejects.toThrow(NetworkRpcEndpointMismatchError);
    expect(mismatch.networks.get("eip155:8453")).toBeNull();
    expect(mismatch.commit).not.toHaveBeenCalled();
    expect(mismatch.changes).toEqual([]);

    const transportFailure = new ChainJsonRpcHttpTransportError("RPC request failed.");
    const unavailable = createFixture();
    unavailable.request.mockRejectedValue(transportFailure);
    await expect(unavailable.networks.addCustom(custom)).rejects.toMatchObject({
      code: NetworkRpcEndpointVerificationError.code,
      cause: transportFailure,
    });
    expect(unavailable.networks.get("eip155:8453")).toBeNull();
    expect(unavailable.commit).not.toHaveBeenCalled();

    const commitFailure = new Error("commit failed");
    const failedCommit = createFixture();
    failedCommit.commit.mockRejectedValue(commitFailure);
    await expect(failedCommit.networks.addCustom(custom)).rejects.toBe(commitFailure);
    expect(failedCommit.networks.get("eip155:8453")).toBeNull();
    expect(failedCommit.changes).toEqual([]);
  });
});
