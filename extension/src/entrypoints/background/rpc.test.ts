import { describe, expect, it } from "vitest";
import { buildProviderRpcContext } from "./rpc";

describe("background rpc helpers", () => {
  it("builds rpc context from provider binding only", () => {
    const providerContext = buildProviderRpcContext({
      origin: "https://example.app",
      providerNamespace: "eip155",
    });

    expect(providerContext).toMatchObject({
      providerNamespace: "eip155",
    });
  });
});
