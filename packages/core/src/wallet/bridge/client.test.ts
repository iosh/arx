import { describe, expect, it } from "vitest";
import { ARX_ERROR_KIND, isArxBaseError } from "../../error.js";
import {
  createRemoteTrustedWalletClient,
  type WalletBridgeClientTransport,
  WalletBridgeProtocolError,
  type WalletBridgeRemoteError,
} from "./client.js";
import type { WalletBridgeReply, WalletBridgeRequest } from "./protocol.js";

describe("remote trusted wallet client", () => {
  it("sends wallet method requests", async () => {
    const requests: WalletBridgeRequest[] = [];
    const transport: WalletBridgeClientTransport = {
      request: async (request) => {
        requests.push(request);
        return {
          type: "wallet:response",
          version: 1,
          id: request.id,
          result: { availability: "ready" },
        };
      },
    };
    const wallet = createRemoteTrustedWalletClient(transport, { createRequestId: () => "request-1" });

    await expect(wallet.setup.getStatus()).resolves.toEqual({ availability: "ready" });
    expect(requests).toEqual([
      {
        type: "wallet:request",
        version: 1,
        id: "request-1",
        path: "setup.getStatus",
      },
    ]);
  });

  it("sends required command inputs through wallet method requests", async () => {
    const requests: WalletBridgeRequest[] = [];
    const transport: WalletBridgeClientTransport = {
      request: async (request) => {
        requests.push(request);
        return {
          type: "wallet:response",
          version: 1,
          id: request.id,
          result: {
            status: "unlocked",
            unlockedAt: 1,
            autoLockDurationMs: 900_000,
            nextAutoLockAt: 900_001,
          },
        };
      },
    };
    const wallet = createRemoteTrustedWalletClient(transport, { createRequestId: () => "request-2" });

    await expect(wallet.session.unlock({ password: "secret" })).resolves.toMatchObject({ status: "unlocked" });
    expect(requests).toEqual([
      {
        type: "wallet:request",
        version: 1,
        id: "request-2",
        path: "session.unlock",
        input: { password: "secret" },
      },
    ]);
  });

  it("throws typed remote errors", async () => {
    const transport: WalletBridgeClientTransport = {
      request: async (request): Promise<WalletBridgeReply> => ({
        type: "wallet:error",
        version: 1,
        id: request.id,
        error: {
          kind: ARX_ERROR_KIND,
          name: "RpcUnsupportedMethodError",
          code: "global.rpc.unsupported_method",
          message: "Unsupported wallet method.",
          details: { path: "setup.getStatus" },
        },
      }),
    };
    const wallet = createRemoteTrustedWalletClient(transport, { createRequestId: () => "request-1" });

    await expect(wallet.setup.getStatus()).rejects.toMatchObject({
      name: "WalletBridgeRemoteError",
      remoteName: "RpcUnsupportedMethodError",
      remoteCode: "global.rpc.unsupported_method",
      code: "wallet.bridge.remote",
      details: {
        remoteName: "RpcUnsupportedMethodError",
        remoteCode: "global.rpc.unsupported_method",
        remoteDetails: { path: "setup.getStatus" },
      },
    } satisfies Partial<WalletBridgeRemoteError>);
  });

  it("rejects reply id mismatches as protocol errors", async () => {
    const transport: WalletBridgeClientTransport = {
      request: async (): Promise<WalletBridgeReply> => ({
        type: "wallet:response",
        version: 1,
        id: "other-request",
        result: null,
      }),
    };
    const wallet = createRemoteTrustedWalletClient(transport, { createRequestId: () => "request-1" });

    await expect(wallet.setup.getStatus()).rejects.toBeInstanceOf(WalletBridgeProtocolError);
  });

  it("rejects reply version mismatches as protocol errors", async () => {
    const transport: WalletBridgeClientTransport = {
      request: async (request): Promise<WalletBridgeReply> => ({
        type: "wallet:response",
        version: 2 as WalletBridgeReply["version"],
        id: request.id,
        result: null,
      }),
    };
    const wallet = createRemoteTrustedWalletClient(transport, { createRequestId: () => "request-1" });

    await expect(wallet.setup.getStatus()).rejects.toMatchObject({
      name: "WalletBridgeProtocolError",
      code: WalletBridgeProtocolError.code,
      details: {
        path: "setup.getStatus",
        reason: "Reply protocol version mismatch: 2.",
      },
    });
  });

  it("uses ArxBaseError for bridge client errors", async () => {
    const transport: WalletBridgeClientTransport = {
      request: async (): Promise<WalletBridgeReply> => ({
        type: "wallet:response",
        version: 1,
        id: "other-request",
        result: null,
      }),
    };
    const wallet = createRemoteTrustedWalletClient(transport, { createRequestId: () => "request-1" });

    await expect(wallet.setup.getStatus()).rejects.toSatisfy(isArxBaseError);
  });
});
