import { Hex, PersonalMessage, TypedData } from "ox";
import { describe, expect, it } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import type { Eip155SignApproval } from "../../approvals/types.js";
import { Permissions } from "../../permissions/Permissions.js";
import { ACCOUNT_ID, ADDRESS, createAccounts, PRIVATE_KEY } from "./__tests__/fixtures.js";
import type { Eip155AccountSigning } from "./accountSigning.js";
import { createEip155DappSigningHandlers } from "./dappSigning.js";
import { signEip155PrivateKeyDigest } from "./keyring.js";

const ORIGIN = "https://dapp.example";
const CHAIN_REF = "eip155:1";
const createHarness = (chainRef = CHAIN_REF) => {
  const accounts = createAccounts();
  const permissions = new Permissions({
    accounts,
    bootstrap: { records: [{ origin: ORIGIN, namespace: "eip155", accountIds: [ACCOUNT_ID] }] },
  });
  const signed: Parameters<Eip155AccountSigning["signDigest"]>[0][] = [];
  const approvals = new Approvals({
    time: {
      now: () => 1,
      schedule: () => () => {},
    },
    publishChanged: () => {},
  });

  const handlers = createEip155DappSigningHandlers({
    accounts,
    permissions,
    approvals,
    accountSigning: {
      signDigest: async (input) => {
        signed.push(input);
        return signEip155PrivateKeyDigest({ ...input, privateKey: PRIVATE_KEY });
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

    const standard = harness.request("personal_sign", ["6869", ADDRESS.slice(2), "ignored"]);
    expect(harness.approve().request).toMatchObject({
      account: {
        accountId: ACCOUNT_ID,
        canonicalAddress: ADDRESS,
        displayAddress: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
      },
      type: "personalMessage",
      message: { format: "hex", value: "0x6869" },
    });
    await standard;
    expect(harness.signed[0]).toEqual({
      accountId: ACCOUNT_ID,
      digest: Hex.toBytes(PersonalMessage.getSignPayload("0x6869")),
    });

    const legacyOrder = harness.request("personal_sign", [ADDRESS, "0x"]);
    expect(harness.approve().request).toMatchObject({
      type: "personalMessage",
      message: { format: "utf8", value: "0x" },
    });
    await legacyOrder;
    expect(harness.signed[1]?.digest).toEqual(Hex.toBytes(PersonalMessage.getSignPayload(Hex.fromString("0x"))));
  });

  it("rejects an RPC address with surrounding whitespace before approval", async () => {
    const harness = createHarness();
    const pending = harness.request("personal_sign", ["0x6869", ` ${ADDRESS} `]);

    expect(harness.approvals.list()).toEqual([]);
    await expect(pending).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
  });

  it("filters typed data for approval and binds domain.chainId to the request chain", async () => {
    const chainId = 4_294_967_297n;
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
