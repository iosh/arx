import { ArxReasons, arxError, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { createSurfaceErrorEncoder } from "./surfaceErrorEncoder.js";

const createAdapter = (): NamespaceProtocolAdapter => ({
  encodeDappError: () => ({ code: 4100, message: "adapter:dapp" }),
  encodeUiError: () => ({ reason: ArxReasons.RpcInternal, message: "adapter:ui" }),
});

describe("createSurfaceErrorEncoder", () => {
  it("routes dapp and ui encoding through the same adapter lookup", () => {
    const lookupCalls: string[] = [];
    const encoder = createSurfaceErrorEncoder({
      getNamespaceProtocolAdapter: (namespace) => {
        lookupCalls.push(namespace);
        return createAdapter();
      },
    });

    expect(
      encoder.encodeDapp(arxError({ reason: ArxReasons.PermissionDenied, message: "denied" }), {
        namespace: "eip155",
        chainRef: "eip155:1",
        method: "eth_sendTransaction",
        origin: "https://dapp.example",
      }),
    ).toEqual({ code: 4100, message: "adapter:dapp" });

    expect(
      encoder.encodeUi(arxError({ reason: ArxReasons.RpcInternal, message: "boom" }), {
        namespace: "eip155",
        chainRef: "eip155:1",
        method: "ui.accounts.switch",
      }),
    ).toEqual({ reason: ArxReasons.RpcInternal, message: "adapter:ui" });

    expect(lookupCalls).toEqual(["eip155", "eip155"]);
  });

  it("executeWithEncoding() returns the encoded error payload", async () => {
    const encoder = createSurfaceErrorEncoder({
      getNamespaceProtocolAdapter: () => createAdapter(),
    });

    const result = await encoder.executeWithEncoding(
      {
        surface: "dapp",
        namespace: "eip155",
        chainRef: "eip155:1",
        method: "eth_sendTransaction",
      },
      async () => {
        throw arxError({ reason: ArxReasons.PermissionDenied, message: "denied" });
      },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 4100, message: "adapter:dapp" },
    });
  });
});
