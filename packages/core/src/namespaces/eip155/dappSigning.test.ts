import { Hex, PersonalMessage, Signature, TypedData } from "ox";
import { describe, expect, it } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import type { Eip155SignApproval } from "../../approvals/types.js";
import type { Permission } from "../../permissions/Permissions.js";
import type { Eip155AccountSigning } from "./accountSigning.js";
import { createEip155DappSigningHandlers } from "./dappSigning.js";
import type { Eip155DigestSignature } from "./keyring.js";

const ORIGIN = "https://dapp.example";
const CHAIN_REF = "eip155:1";
const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
const ACCOUNT_ID = `eip155:${ADDRESS.slice(2)}`;
const SIGNATURE: Eip155DigestSignature = {
  r: 1n,
  s: 2n,
  yParity: 1,
  bytes: new Uint8Array(64),
};

const createHarness = (chainRef = CHAIN_REF) => {
  const permission: Permission = {
    origin: ORIGIN,
    namespace: "eip155",
    accountIds: [ACCOUNT_ID],
  };
  const signed: Parameters<Eip155AccountSigning["signDigest"]>[0][] = [];
  const approvals = new Approvals({
    time: {
      now: () => 1,
      schedule: () => () => {},
    },
    publishChanged: () => {},
  });

  const handlers = createEip155DappSigningHandlers({
    accounts: {
      accountIdFromAddress: ({ address }) => `eip155:${address.replace(/^0x/, "").toLowerCase()}`,
      getAccount: (accountId) =>
        accountId === ACCOUNT_ID
          ? {
              accountId,
              namespace: "eip155",
              origin: { type: "private-key", keySourceId: "source" },
              hidden: false,
              selected: true,
              createdAt: 1,
            }
          : null,
      getAddress: ({ accountId, chainRef }) => ({
        accountId,
        chainRef,
        canonicalAddress: ADDRESS,
        displayAddress: ADDRESS,
      }),
    },
    permissions: { get: () => permission },
    approvals,
    accountSigning: {
      signDigest: async (input) => {
        signed.push(input);
        return SIGNATURE;
      },
    },
  });

  return {
    approvals,
    signed,
    request: (method: "personal_sign" | "eth_signTypedData_v4", params: unknown) => {
      const request = method === "personal_sign" ? handlers.personalSign : handlers.signTypedDataV4;
      return request({ origin: ORIGIN, chainRef, method, params });
    },
    approve: (): Eip155SignApproval => {
      const approval = approvals.list()[0];
      if (approval?.type !== "sign") throw new Error("Expected a sign approval.");
      approvals.approve({ approvalId: approval.approvalId, type: "sign" });
      return approval;
    },
  };
};

describe("EIP-155 dapp signing", () => {
  it("preserves personal_sign compatibility while signing the decoded message bytes", async () => {
    const harness = createHarness();

    const standard = harness.request("personal_sign", ["6869", ADDRESS, "ignored"]);
    expect(harness.approve().request).toMatchObject({
      type: "personalMessage",
      message: { format: "hex", value: "0x6869" },
    });
    await expect(standard).resolves.toBe(Signature.toHex(SIGNATURE));
    expect(harness.signed[0]?.digest).toEqual(Hex.toBytes(PersonalMessage.getSignPayload("0x6869")));

    const legacyOrder = harness.request("personal_sign", [ADDRESS, "0x"]);
    expect(harness.approve().request).toMatchObject({
      type: "personalMessage",
      message: { format: "utf8", value: "0x" },
    });
    await legacyOrder;
    expect(harness.signed[1]?.digest).toEqual(Hex.toBytes(PersonalMessage.getSignPayload(Hex.fromString("0x"))));
  });

  it("filters typed data for approval and binds domain.chainId without number coercion", async () => {
    const chainId = 9_007_199_254_740_993n;
    const harness = createHarness(`eip155:${chainId}`);
    const typedData = {
      types: {
        EIP712Domain: [{ name: "chainId", type: "uint256" }],
        Message: [{ name: "details", type: "Details[]" }],
        Details: [{ name: "contents", type: "string" }],
      },
      primaryType: "Message",
      domain: { chainId: `0x${chainId.toString(16)}`, ignored: "not signed" },
      message: {
        details: [{ contents: "hello", ignored: "not signed" }],
        ignored: "not signed",
      },
    } as const;

    const pending = harness.request("eth_signTypedData_v4", [ADDRESS, JSON.stringify(typedData)]);
    const approval = harness.approve();
    if (approval.request.type !== "typedData") throw new Error("Expected a typed data approval.");
    expect(approval.request.typedData).toEqual({
      types: typedData.types,
      primaryType: "Message",
      domain: { chainId: chainId.toString(10) },
      message: { details: [{ contents: "hello" }] },
    });
    await pending;
    expect(harness.signed[0]?.digest).toEqual(
      Hex.toBytes(
        TypedData.getSignPayload({
          types: typedData.types,
          primaryType: "Message",
          domain: { chainId },
          message: { details: [{ contents: "hello" }] },
        }),
      ),
    );

    await expect(
      harness.request("eth_signTypedData_v4", [
        ADDRESS,
        { ...typedData, domain: { chainId: (chainId + 1n).toString(10) } },
      ]),
    ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });

    await expect(
      harness.request("eth_signTypedData_v4", [
        ADDRESS,
        {
          ...typedData,
          types: {
            ...typedData.types,
            Message: [{ name: "details", type: "Details[2]" }],
          },
          message: { details: [{ contents: "hello" }] },
        },
      ]),
    ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    expect(harness.approvals.list()).toEqual([]);
  });
});
