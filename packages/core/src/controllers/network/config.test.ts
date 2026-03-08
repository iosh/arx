import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import {
  buildNetworkRuntimeInput,
  cloneNetworkStateInput,
  cloneRpcEndpoints,
  fingerprintRpcEndpoints,
} from "./config.js";
import type { NetworkStateInput } from "./types.js";

const METADATA: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [
    {
      url: "https://rpc.ethereum.example",
      type: "authenticated",
      headers: { Authorization: "Bearer token", "X-Client": "arx" },
    },
  ],
};

const STATE: NetworkStateInput = {
  activeChainRef: METADATA.chainRef,
  availableChainRefs: [METADATA.chainRef],
  rpc: {
    [METADATA.chainRef]: {
      activeIndex: 0,
      strategy: { id: "round-robin", options: { jitter: true } },
    },
  },
};

describe("network config helpers", () => {
  it("deep clones rpc endpoints", () => {
    const cloned = cloneRpcEndpoints(METADATA.rpcEndpoints);

    expect(cloned).toEqual(METADATA.rpcEndpoints);
    expect(cloned).not.toBe(METADATA.rpcEndpoints);
    expect(cloned[0]?.headers).not.toBe(METADATA.rpcEndpoints[0]?.headers);
  });

  it("produces stable rpc fingerprints", () => {
    const a = [{ url: "https://rpc.ethereum.example", headers: { Authorization: "a", "X-Client": "arx" } }];
    const b = [{ url: "https://rpc.ethereum.example", headers: { "X-Client": "arx", Authorization: "a" } }];

    expect(fingerprintRpcEndpoints(a)).toBe(fingerprintRpcEndpoints(b));
    expect(fingerprintRpcEndpoints(a)).not.toBe(fingerprintRpcEndpoints([{ url: "https://rpc.other.example" }]));
  });

  it("builds isolated network runtime input", () => {
    const runtime = buildNetworkRuntimeInput(STATE, [METADATA]);
    const clonedState = cloneNetworkStateInput(STATE);

    STATE.availableChainRefs.push("eip155:10");
    STATE.rpc[METADATA.chainRef].strategy.options = { jitter: false };
    (METADATA.rpcEndpoints[0].headers as Record<string, string>).Authorization = "Changed";

    expect(runtime.state).toEqual(clonedState);
    expect(runtime.chainConfigs[0]?.rpcEndpoints[0]?.headers?.Authorization).toBe("Bearer token");
  });
});
