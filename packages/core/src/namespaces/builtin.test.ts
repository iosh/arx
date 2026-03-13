import { describe, expect, it } from "vitest";
import { BUILTIN_RPC_NAMESPACE_MODULES } from "../rpc/namespaces/builtin.js";
import { BUILTIN_NAMESPACE_MANIFESTS, createBuiltinKeyringNamespaces } from "./builtin.js";

describe("builtin namespace manifests", () => {
  it("exposes eip155 as the current builtin namespace manifest", () => {
    expect(BUILTIN_NAMESPACE_MANIFESTS.map((manifest) => manifest.namespace)).toEqual(["eip155"]);

    const [manifest] = BUILTIN_NAMESPACE_MANIFESTS;
    expect(manifest?.core.rpc.namespace).toBe("eip155");
    expect(manifest?.core.chainAddressCodec.namespace).toBe("eip155");
    expect(manifest?.core.accountCodec.namespace).toBe("eip155");
    expect(manifest?.core.keyring.namespace).toBe("eip155");
    expect(manifest?.core.chainSeeds?.every((chain) => chain.namespace === "eip155")).toBe(true);
  });

  it("drives rpc builtins and default keyring namespaces from the same source", () => {
    expect(BUILTIN_RPC_NAMESPACE_MODULES).toEqual(BUILTIN_NAMESPACE_MANIFESTS.map((manifest) => manifest.core.rpc));

    const namespaces = createBuiltinKeyringNamespaces();
    expect(namespaces.map((entry) => entry.namespace)).toEqual(["eip155"]);
    expect(namespaces[0]).not.toBe(BUILTIN_NAMESPACE_MANIFESTS[0]?.core.keyring);
  });
});
