import { describe, expect, it } from "vitest";
import { applyEip155TransactionDraftEdit } from "./applyDraftEdit.js";

describe("applyEip155TransactionDraftEdit", () => {
  it("applies execution-control edits to the draft request", () => {
    const next = applyEip155TransactionDraftEdit({
      transactionId: "tx-1",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      from: "0x1111111111111111111111111111111111111111",
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {
          gas: "0x5208",
          gasPrice: "0x1",
          maxFeePerGas: "0x2",
          maxPriorityFeePerGas: "0x3",
          nonce: "0x4",
        },
      },
      edit: {
        namespace: "eip155",
        changes: [
          { field: "gas", value: "0x5300" },
          { field: "gasPrice", value: null },
          { field: "maxFeePerGas", value: "0x5" },
          { field: "maxPriorityFeePerGas", value: "0x6" },
          { field: "nonce", value: "0x7" },
        ],
      },
    });

    expect(next).toMatchObject({
      namespace: "eip155",
      payload: {
        gas: "0x5300",
        maxFeePerGas: "0x5",
        maxPriorityFeePerGas: "0x6",
        nonce: "0x7",
      },
    });
    expect(next.payload).not.toHaveProperty("gasPrice");
  });

  it("rejects non-eip155 edit namespaces", () => {
    expect(() =>
      applyEip155TransactionDraftEdit({
        transactionId: "tx-1",
        namespace: "eip155",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        from: "0x1111111111111111111111111111111111111111",
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: {},
        },
        edit: {
          namespace: "solana",
          changes: [],
        } as never,
      }),
    ).toThrow('EIP-155 draft editor received edit namespace "solana".');
  });
});
