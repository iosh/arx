import { Hex, TypedData } from "ox";
import { assert, expect, it } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import { Permissions } from "../../permissions/Permissions.js";
import { ACCOUNT_ID, ADDRESS, createAccounts, PRIVATE_KEY } from "./__tests__/fixtures.js";
import { chainRefFromChainId } from "./chainId.js";
import { createEip155DappSigningHandlers } from "./dappSigning.js";
import { signEip155Digest } from "./keyring.js";

it("approves only signed typed-data fields and rejects inconsistent request data", async () => {
  const chainId = 4_294_967_297n;
  const chainRef = chainRefFromChainId(chainId);
  const origin = "https://dapp.example";
  const accounts = createAccounts();
  const permissions = new Permissions({
    accounts,
    bootstrap: { records: [{ origin, namespace: "eip155", accountIds: [ACCOUNT_ID] }] },
    publishChanged: () => undefined,
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
        const privateKey = Hex.toBytes(`0x${PRIVATE_KEY}`);
        try {
          return signEip155Digest({ ...input, privateKey });
        } finally {
          privateKey.fill(0);
        }
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

  await expect(request([ADDRESS, JSON.stringify({ ...typedData, primaryType: 1 })])).rejects.toMatchObject({
    code: "global.rpc.invalid_params",
    message: expect.stringContaining("typedData.primaryType"),
  });
  const pending = request([ADDRESS.slice(2).toUpperCase(), JSON.stringify(typedData)]);
  const [approval] = approvals.list();
  assert(approval?.type === "sign" && approval.request.type === "typedData");
  expect(approval.request.typedData).toEqual({
    types: typedData.types,
    primaryType: "Message",
    domain: { chainId: `${chainId}` },
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

  await expect(request([ADDRESS, { ...typedData, domain: { chainId: `${chainId + 1n}` } }])).rejects.toMatchObject({
    code: "global.rpc.invalid_params",
  });
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
  const { EIP712Domain: _domainFields, ...withoutDomainTypes } = typedData.types;
  await expect(request([ADDRESS, { ...typedData, types: withoutDomainTypes }])).rejects.toMatchObject({
    code: "global.rpc.invalid_params",
  });
  expect(approvals.list()).toEqual([]);

  const emptyDomainTypes = { ...typedData.types, EIP712Domain: [] };
  const domainless = request([
    ADDRESS,
    { ...typedData, types: emptyDomainTypes, domain: { chainId: `${chainId + 1n}` } },
  ]);
  const [domainlessApproval] = approvals.list();
  assert(domainlessApproval?.type === "sign" && domainlessApproval.request.type === "typedData");
  expect(domainlessApproval.request.typedData.domain).toEqual({});
  approvals.approve({ approvalId: domainlessApproval.approvalId, type: "sign" });
  await domainless;
  expect(signedDigest).toEqual(
    Hex.toBytes(
      TypedData.getSignPayload({
        types: emptyDomainTypes,
        primaryType: "Message",
        domain: {},
        message: { details: [{ contents: "hello" }] },
      }),
    ),
  );

  const domainOnlyData = {
    types: { EIP712Domain: [{ name: "name", type: "string" }] },
    primaryType: "EIP712Domain",
    domain: { name: "Signed domain" },
  } as const;
  const domainOnlyDigest = Hex.toBytes(TypedData.getSignPayload(domainOnlyData));

  for (const message of [{ name: "Unsigned message" }, {}]) {
    const domainOnly = request([ADDRESS, { ...domainOnlyData, message }]);
    const [domainOnlyApproval] = approvals.list();
    assert(domainOnlyApproval?.type === "sign" && domainOnlyApproval.request.type === "typedData");
    expect(domainOnlyApproval.request.typedData).toEqual({ ...domainOnlyData, message: {} });
    approvals.approve({ approvalId: domainOnlyApproval.approvalId, type: "sign" });
    await domainOnly;
    expect(signedDigest).toEqual(domainOnlyDigest);
  }
});
