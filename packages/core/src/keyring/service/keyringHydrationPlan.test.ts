import { describe, expect, it } from "vitest";
import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import { buildKeyringHydrationPlan } from "./keyringHydrationPlan.js";
import type { Payload } from "./types.js";

const NOW = 1_700_000_000_000;

const buildPayload = (): Payload => ({
  keyrings: [
    {
      keyringId: "11111111-1111-4111-8111-111111111111",
      type: "hd",
      createdAt: NOW,
      version: 1,
      namespace: "eip155",
      payload: {
        mnemonic: ["test", "test", "test", "test", "test", "test", "test", "test", "test", "test", "test", "junk"],
      },
    },
    {
      keyringId: "33333333-3333-4333-8333-333333333333",
      type: "private-key",
      createdAt: NOW + 2,
      version: 1,
      namespace: "eip155",
      payload: {
        privateKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    },
  ],
});

const buildMetas = (): KeyringMetaRecord[] => [
  {
    id: "11111111-1111-4111-8111-111111111111",
    type: "hd",
    createdAt: NOW,
    needsBackup: true,
    nextDerivationIndex: 1,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    type: "private-key",
    createdAt: NOW + 1,
  },
];

const buildAccounts = (): AccountRecord[] => [
  {
    accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    namespace: "eip155",
    keyringId: "11111111-1111-4111-8111-111111111111",
    derivationIndex: 0,
    createdAt: NOW,
  },
  {
    accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    namespace: "eip155",
    keyringId: "22222222-2222-4222-8222-222222222222",
    createdAt: NOW + 1,
  },
  {
    accountId: "eip155:cccccccccccccccccccccccccccccccccccccccc",
    namespace: "eip155",
    keyringId: "33333333-3333-4333-8333-333333333333",
    createdAt: NOW + 2,
  },
];

describe("buildKeyringHydrationPlan", () => {
  it("plans metadata cleanup and minimal metadata creation for vault-backed keyrings", () => {
    const result = buildKeyringHydrationPlan({
      payload: buildPayload(),
      keyringMetas: buildMetas(),
      accounts: buildAccounts(),
    });

    expect(result.keyringIdsToRemove).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(result.metasToCreate).toEqual([
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: "private-key",
        createdAt: NOW + 2,
      },
    ]);
    expect(result.metasToLoad.map((meta) => meta.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(result.accountsToLoad.map((account) => account.accountId)).toEqual([
      "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "eip155:cccccccccccccccccccccccccccccccccccccccc",
    ]);
  });
});
