import { describe, expect, it } from "vitest";
import { parsePageToWalletMessage, parseWalletToPageMessage } from "./parse.js";

describe("provider protocol", () => {
  it("decodes protocol messages and rejects non-JSON dapp params", () => {
    const params = ["0x1234", { block: "latest" }];
    const request = parsePageToWalletMessage({
      type: "request",
      namespace: "eip155",
      id: 4,
      method: "eth_getBalance",
      params,
    });
    expect(request).toEqual({
      type: "request",
      namespace: "eip155",
      id: 4,
      method: "eth_getBalance",
      params: ["0x1234", { block: "latest" }],
    });
    expect(request?.type === "request" ? request.params : null).not.toBe(params);

    expect(
      parseWalletToPageMessage({
        type: "connection_changed",
        namespace: "eip155",
        connection: { chainRef: "eip155:10", accounts: ["0x1234"] },
      }),
    ).toEqual({
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: ["0x1234"] },
    });
    expect(
      parseWalletToPageMessage({
        type: "failure",
        namespace: "eip155",
        id: 9,
        error: {
          kind: "json_rpc_response",
          message: "Node failure.",
          data: { code: -32000, data: { request: "eth_call" } },
        },
      }),
    ).toEqual({
      type: "failure",
      namespace: "eip155",
      id: 9,
      error: {
        kind: "json_rpc_response",
        message: "Node failure.",
        data: { code: -32000, data: { request: "eth_call" } },
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      parsePageToWalletMessage({ type: "request", namespace: "eip155", id: 1, method: "test", params: cyclic }),
    ).toBeNull();
  });
});
