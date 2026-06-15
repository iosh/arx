import { describe, expect, it } from "vitest";
import { createCoreProviderRequestEnvelope } from "./rpc";

describe("background rpc helpers", () => {
  it("builds provider request envelope from session context and raw rpc payload", () => {
    const envelope = createCoreProviderRequestEnvelope(
      {
        origin: "https://example.app",
        namespace: "eip155",
      },
      {
        id: "rpc-1",
        jsonrpc: "2.0",
        method: "eth_chainId",
      },
    );

    expect(envelope).toEqual({
      id: "rpc-1",
      jsonrpc: "2.0",
      method: "eth_chainId",
      namespace: "eip155",
    });
  });
});
