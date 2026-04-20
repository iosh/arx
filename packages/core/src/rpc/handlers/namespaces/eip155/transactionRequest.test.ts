import { describe, expect, it } from "vitest";
import { buildEip155TransactionRequest } from "./transactionRequest.js";

describe("buildEip155TransactionRequest", () => {
  it("preserves explicit chainId from eth_sendTransaction params", () => {
    const request = buildEip155TransactionRequest(
      [
        {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
          chainId: "0xa",
        },
      ],
      "eip155:10",
    );

    expect(request).toEqual({
      namespace: "eip155",
      chainRef: "eip155:10",
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x0",
        data: "0x",
        chainId: "0xa",
      },
    });
  });
});
