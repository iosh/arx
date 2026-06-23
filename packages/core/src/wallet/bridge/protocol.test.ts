import { describe, expect, it } from "vitest";
import { ARX_ERROR_KIND } from "../../error.js";
import { parseWalletBridgeReply, parseWalletBridgeRequest } from "./protocol.js";

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
  });
});
