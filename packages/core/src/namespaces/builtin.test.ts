import { describe, expect, it } from "vitest";
import { getChainRefNamespace } from "../chains/caip.js";
import { buildAccountAddressingByNamespaceFromManifests } from "./assembly.js";
import { BUILTIN_NAMESPACE_MANIFESTS } from "./builtin.js";

describe("builtin namespace manifests", () => {
  it("exposes eip155 as the current builtin namespace manifest", () => {
    expect(BUILTIN_NAMESPACE_MANIFESTS.map((manifest) => manifest.namespace)).toEqual(["eip155"]);

    const [manifest] = BUILTIN_NAMESPACE_MANIFESTS;
    expect(manifest?.core.rpc.namespace).toBe("eip155");
    expect(manifest?.core.chainAddressing.namespace).toBe("eip155");
    expect(manifest?.core.accountAddressing.namespace).toBe("eip155");
    expect(manifest?.core.keyringAdapter.namespace).toBe("eip155");
    expect(
      manifest?.core.chainSeeds?.every((chain) => getChainRefNamespace(chain.definition.chainRef) === "eip155"),
    ).toBe(true);
  });

  it("can derive account addressing from builtin manifests", () => {
    const accountAddressing = buildAccountAddressingByNamespaceFromManifests(BUILTIN_NAMESPACE_MANIFESTS);
    expect(Object.keys(accountAddressing)).toEqual(["eip155"]);
    expect(accountAddressing.eip155).toBe(BUILTIN_NAMESPACE_MANIFESTS[0]?.core.accountAddressing);
  });
});
