import { Hex, TypedData } from "ox";
import { assert, expect, it } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import { Permissions } from "../../permissions/Permissions.js";
import { ACCOUNT_ID, ADDRESS, createAccounts, PRIVATE_KEY } from "./__tests__/fixtures.js";
import { createEip155DappSigningHandlers } from "./dappSigning.js";
import { signEip155PrivateKeyDigest } from "./keyring.js";

it("approves only signed typed-data fields and rejects inconsistent request data", async () => {
  const chainId = 4_294_967_297n;
  const chainRef = `eip155:${chainId}`;
  const origin = "https://dapp.example";
  const accounts = createAccounts();
  const permissions = new Permissions({
    accounts,
    bootstrap: { records: [{ origin, namespace: "eip155", accountIds: [ACCOUNT_ID] }] },
  });
  const approvals = new Approvals({
    time: { now: () => 1, schedule: () => () => {} },
    publishChanged: () => {},
  });
  let signedDigest: Uint8Array | undefined;
  const { signTypedDataV4 } = createEip155DappSigningHandlers({
    accounts,
    permissions,
    approvals,
    accountSigning: {
      signDigest: async (input) => {
        signedDigest = input.digest;
        return signEip155PrivateKeyDigest({ ...input, privateKey: PRIVATE_KEY });
      },
    },
  });
  const request = (params: unknown) => signTypedDataV4({ origin, chainRef, method: "eth_signTypedData_v4", params });
  const typedData = {
    types: {
      EIP712Domain: [{ name: "chainId", type: "uint256" }],
      Message: [{ name: "details", type: "Details[]" }],
      Details: [{ name: "contents", type: "string" }],
    },
    primaryType: "Message",
    domain: { chainId: `0x${chainId.toString(16)}`, ignored: "not signed" },
    message: { details: [{ contents: "hello", ignored: "not signed" }], ignored: "not signed" },
  } as const;

  const pending = request([ADDRESS, JSON.stringify(typedData)]);
  const [approval] = approvals.list();
  assert(approval?.type === "sign" && approval.request.type === "typedData");
  expect(approval.request.typedData).toEqual({
    types: typedData.types,
    primaryType: "Message",
    domain: { chainId: chainId.toString(10) },
    message: { details: [{ contents: "hello" }] },
  });
  approvals.approve({ approvalId: approval.approvalId, type: "sign" });
  await pending;
  expect(signedDigest).toEqual(
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
    request([ADDRESS, { ...typedData, domain: { chainId: (chainId + 1n).toString(10) } }]),
  ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
  await expect(
    request([
      ADDRESS,
      {
        ...typedData,
        types: { ...typedData.types, Message: [{ name: "details", type: "Details[2]" }] },
        message: { details: [{ contents: "hello" }] },
      },
    ]),
  ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
  expect(approvals.list()).toEqual([]);
});
