import { ArxReasons, arxError, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { createEip155ProtocolAdapter } from "../rpc/eip155ProtocolAdapter.js";
import { createSurfaceErrorEncoder } from "./surfaceErrorEncoder.js";

const createAdapter = (): NamespaceProtocolAdapter => ({
  encodeDappError: () => ({ code: 4100, message: "adapter:dapp" }),
});

describe("createSurfaceErrorEncoder", () => {
  it("routes only dapp encoding through namespace adapter lookup", () => {
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
    ).toEqual({ reason: ArxReasons.RpcInternal, message: "boom" });

    expect(lookupCalls).toEqual(["eip155"]);
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

  it("does not leak unknown error messages through the RpcInternal fallback", () => {
    const encoder = createSurfaceErrorEncoder({
      getNamespaceProtocolAdapter: () => createAdapter(),
    });

    expect(
      encoder.encodeDapp(new Error("boom"), {
        method: "eth_chainId",
      }),
    ).toEqual({
      code: -32603,
      message: "Internal error",
      data: {
        method: "eth_chainId",
      },
    });
  });

  it("sanitizes passthrough JSON-RPC errors for dapp surfaces", () => {
    const encoder = createSurfaceErrorEncoder({
      getNamespaceProtocolAdapter: () => createAdapter(),
    });

    expect(
      encoder.encodeDapp(
        {
          code: -32000,
          message: "Upstream error",
          data: { value: 1n },
        },
        {
          method: "eth_call",
        },
      ),
    ).toEqual({
      code: -32000,
      message: "Upstream error",
    });
  });

  it("keeps ui encoding on the generic contract even when namespace is present", () => {
    const lookupCalls: string[] = [];
    const encoder = createSurfaceErrorEncoder({
      getNamespaceProtocolAdapter: (namespace) => {
        lookupCalls.push(namespace);
        return createAdapter();
      },
    });

    expect(
      encoder.encodeUi(
        arxError({
          reason: ArxReasons.PermissionDenied,
          message: "",
          data: { retryable: true },
        }),
        {
          namespace: "eip155",
          chainRef: "eip155:1",
          method: "ui.accounts.switch",
        },
      ),
    ).toEqual({
      reason: ArxReasons.PermissionDenied,
      message: "Permission denied",
      data: { retryable: true },
    });

    expect(lookupCalls).toEqual([]);
  });

  it("lets eip155 adapter own 4902 compatibility mapping for chain reasons", () => {
    const encoder = createSurfaceErrorEncoder({
      getNamespaceProtocolAdapter: () => createEip155ProtocolAdapter(),
    });

    expect(
      encoder.encodeDapp(
        arxError({
          reason: ArxReasons.ChainNotSupported,
          message: "Requested chain conflicts with a builtin chain definition",
          data: { chainRef: "eip155:11155111" },
        }),
        {
          namespace: "eip155",
          chainRef: "eip155:1",
          method: "wallet_addEthereumChain",
        },
      ),
    ).toEqual({
      code: 4902,
      message: "Unrecognized chain",
      data: { chainRef: "eip155:11155111" },
    });
  });
});
