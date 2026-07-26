import { describe, expect, it } from "vitest";
import { createEip155ReplacementRequest } from "./replacementTransaction.js";
import type * as Eip155 from "./types.js";

const transaction = (transactionFields: Eip155.Transaction["transaction"]): Eip155.Transaction => ({
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: "eip155:1",
  accountId: "eip155:0000000000000000000000000000000000000001",
  initiator: { type: "wallet" },
  transaction: transactionFields,
  state: { status: "pending" },
  createdAt: 1,
  updatedAt: 1,
});

describe("EIP-155 replacement transactions", () => {
  it("preserves the original transaction while increasing a legacy fee by ten percent", () => {
    const target = transaction({
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: null,
      value: "0x3",
      data: "0xabcd",
      gas: "0x10000",
      nonce: "0x7",
      type: "legacy",
      gasPrice: "0x64",
    });

    const request = createEip155ReplacementRequest({
      target,
      type: "speed-up",
      from: target.transaction.from,
    });

    expect(request).toEqual({
      to: null,
      value: "0x3",
      data: "0xabcd",
      gas: "0x10000",
      nonce: "0x7",
      type: "legacy",
      gasPrice: "0x6e",
    });

    const zeroFeeTarget = transaction({
      ...target.transaction,
      type: "legacy",
      gasPrice: "0x0",
    });
    expect(
      createEip155ReplacementRequest({
        target: zeroFeeTarget,
        type: "speed-up",
        from: zeroFeeTarget.transaction.from,
      }),
    ).toMatchObject({ gasPrice: "0x1" });
  });

  it("builds a self-transfer cancellation with bigint-safe rounded fee increases", () => {
    const target = transaction({
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0xffff",
      data: "0xabcd",
      gas: "0x10000",
      nonce: "0x7",
      type: "eip1559",
      maxFeePerGas: "0x20000000000001",
      maxPriorityFeePerGas: "0x1",
      accessList: [],
    });

    expect(
      createEip155ReplacementRequest({
        target,
        type: "cancel",
        from: target.transaction.from,
      }),
    ).toEqual({
      to: target.transaction.from,
      value: "0x0",
      data: "0x",
      gas: "0x5208",
      nonce: "0x7",
      type: "eip1559",
      maxFeePerGas: "0x23333333333335",
      maxPriorityFeePerGas: "0x2",
      accessList: [],
    });
  });
});
