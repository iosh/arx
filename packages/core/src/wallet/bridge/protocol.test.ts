import { describe, expect, it } from "vitest";
import { ARX_ERROR_KIND } from "../../error.js";
import {
  isWalletBridgeEventMessage,
  parseWalletBridgeEvent,
  parseWalletBridgeReply,
  parseWalletBridgeRequest,
} from "./protocol.js";

describe("wallet bridge protocol", () => {
  it("parses request, response, and error messages", () => {
    expect(
      parseWalletBridgeRequest({
        type: "wallet:request",
        version: 1,
        id: "request-1",
        path: "setup.getStatus",
      }),
    ).toEqual({
      type: "wallet:request",
      version: 1,
      id: "request-1",
      path: "setup.getStatus",
    });

    expect(
      parseWalletBridgeReply({
        type: "wallet:response",
        version: 1,
        id: "request-1",
        result: undefined,
      }),
    ).toEqual({
      type: "wallet:response",
      version: 1,
      id: "request-1",
      result: undefined,
    });

    expect(
      parseWalletBridgeReply({
        type: "wallet:error",
        version: 1,
        id: "request-1",
        error: {
          kind: ARX_ERROR_KIND,
          name: "RpcInvalidRequestError",
          code: "global.rpc.invalid_request",
          message: "Invalid request.",
        },
      }),
    ).toMatchObject({ type: "wallet:error", id: "request-1" });
  });

  it("parses wallet invalidation events", () => {
    expect(
      parseWalletBridgeEvent({
        type: "wallet:event",
        version: 1,
        event: "wallet:invalidation",
        topic: "approvals",
      }),
    ).toEqual({
      type: "wallet:event",
      version: 1,
      event: "wallet:invalidation",
      topic: "approvals",
    });

    expect(isWalletBridgeEventMessage({ type: "wallet:event" })).toBe(true);
    expect(isWalletBridgeEventMessage({ type: "wallet:response" })).toBe(false);
  });

  it("rejects invalid message shapes", () => {
    expect(() =>
      parseWalletBridgeRequest({
        type: "wallet:request",
        version: 2,
        id: "request-1",
        path: "setup.getStatus",
      }),
    ).toThrow();

    expect(() =>
      parseWalletBridgeReply({
        type: "wallet:response",
        version: 1,
        id: "request-1",
      }),
    ).toThrow();

    expect(() =>
      parseWalletBridgeEvent({
        type: "wallet:event",
        version: 1,
        event: "wallet:invalidation",
        topic: "approval-1",
      }),
    ).toThrow();
  });
});
