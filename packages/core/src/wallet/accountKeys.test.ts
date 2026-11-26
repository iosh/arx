import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assert, expect, it } from "vitest";
import { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountGroupSource } from "../accounts/persistence.js";
import { Keyring } from "../keyring/Keyring.js";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { type Eip155DigestSignature, eip155KeyringAdapter, signEip155Digest } from "../namespaces/eip155/keyring.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { commitUpdates } from "../persistence/preparedUpdate.js";
import { AutoLockController } from "./AutoLockController.js";
import { createAccountKeys } from "./accountKeys.js";
import { getWalletStatus } from "./walletStatus.js";

const DIGEST = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PRIVATE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PRIVATE_ACCOUNT_ID = "eip155:fcad0b19bb29d4674531d6f115237e16afce377c";
const HD_ACCOUNT_ID = "eip155:f3f50213c1d2e255e4b2bad430f8a38eef8d718e";
const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const recoverAccountId = (signature: Eip155DigestSignature): AccountId => {
  const publicKey = new secp256k1.Signature(signature.r, signature.s)
    .addRecoveryBit(signature.yParity)
    .recoverPublicKey(DIGEST)
    .toRawBytes(false);
  return `eip155:${bytesToHex(keccak_256(publicKey.subarray(1)).slice(-20))}`;
};

const createFixture = async (kind: "bip39" | "private-key") => {
  const mutations = createCoreMutationQueue({ commit: async () => {} });
  const adapter = { ...eip155KeyringAdapter };
  const keyring = new Keyring({
    bootstrap: { encryptedVault: null, keySources: [] },
    namespaceAdapters: { eip155: adapter },
    mutations,
    publishChanged: () => {},
  });
  const accounts = new Accounts({
    adapters: { eip155: eip155AccountsAdapter },
    bootstrap: { groups: [], selection: null },
    mutations,
    publishChanged: () => {},
  });
  let accountId: AccountId | undefined;
  await mutations.run(async (commit) => {
    if (kind === "private-key") {
      const addition = await keyring.prepareInitializePrivateKeySource({
        namespace: "eip155",
        privateKey: PRIVATE_KEY,
        password: "password",
        createdAt: 1,
      });
      accountId = addition.accountId;
      const group = accounts.prepareAddGroup({
        accountGroupId: "group-0",
        source: { type: "private-key", keySourceId: addition.keySourceId },
        members: [{ accountId }],
        createdAt: 1,
      });
      await commitUpdates(commit, [addition.update, group.update]);
    } else {
      const addition = await keyring.prepareInitializeBip39Source({
        mnemonic: MNEMONIC,
        password: "password",
        name: "Wallet",
        backupStatus: "confirmed",
        createdAt: 1,
      });
      for (let accountIndex = 0; accountIndex <= 3; accountIndex++) {
        const members = keyring.deriveBip39AccountIds({ mnemonic: MNEMONIC, namespaces: ["eip155"], accountIndex });
        accountId = members[0].accountId;
        const source: AccountGroupSource = { type: "bip39", keySourceId: addition.keySourceId, accountIndex };
        const group = accounts.prepareAddGroup({
          accountGroupId: `group-${accountIndex}`,
          source,
          members,
          createdAt: accountIndex + 1,
        });
        await commitUpdates(commit, [accountIndex === 0 ? addition.update : null, group.update]);
      }
    }
  });
  let now = 1;
  const autoLock = new AutoLockController({ durationMs: 60_000, time: { now: () => now, schedule: () => () => {} } });
  autoLock.start(() => {});
  const wallet = { getStatus: () => getWalletStatus(keyring.getSoftwareKeyStatus(), autoLock.isExpired()) };
  const keys = createAccountKeys({ accounts, keyring, wallet });
  assert(accountId);
  return {
    accountId,
    adapter,
    keyring,
    keys,
    mutations,
    wallet,
    expire: () => {
      now = 60_001;
    },
  };
};

it("signs with the imported account key and clears its temporary bytes", async () => {
  const { accountId, keys } = await createFixture("private-key");
  let material: Uint8Array | undefined;
  const signature = keys.withPrivateKey(accountId, (privateKey) => {
    material = privateKey;
    return signEip155Digest({ privateKey, digest: DIGEST });
  });
  expect(recoverAccountId(signature)).toBe(PRIVATE_ACCOUNT_ID);
  expect(material).toEqual(new Uint8Array(32));
});

it("signs with the persisted HD account index", async () => {
  const { accountId, keys } = await createFixture("bip39");
  const signature = keys.withPrivateKey(accountId, (privateKey) => signEip155Digest({ privateKey, digest: DIGEST }));
  expect(accountId).toBe(HD_ACCOUNT_ID);
  expect(recoverAccountId(signature)).toBe(HD_ACCOUNT_ID);
});

it("refuses a regressed derivation for both signing and export, and clears the rejected key", async () => {
  const { accountId, adapter, keyring, keys, mutations, wallet } = await createFixture("bip39");
  const derive = adapter.derivePrivateKey;
  let material: Uint8Array | undefined;
  adapter.derivePrivateKey = (input) => {
    material = derive({ ...input, accountIndex: input.accountIndex + 1 });
    return material;
  };
  const signatures: Eip155DigestSignature[] = [];
  expect(() =>
    keys.withPrivateKey(accountId, (privateKey) => {
      const signature = signEip155Digest({ privateKey, digest: DIGEST });
      signatures.push(signature);
      return signature;
    }),
  ).toThrow("Derived key does not match");
  expect(signatures).toEqual([]);
  expect(material).toEqual(new Uint8Array(32));
  await expect(
    mutations.run(async () => {
      expect(wallet.getStatus()).toBe("unlocked");
      assert(await keyring.verifyPassword("password"));
      return keys.exportPrivateKey(accountId);
    }),
  ).rejects.toThrow("Derived key does not match");
  expect(material).toEqual(new Uint8Array(32));
});

it("refuses a new signature after expiry even before the queued lock runs", async () => {
  const { accountId, keyring, keys, expire } = await createFixture("private-key");
  expire();
  expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");
  expect(() =>
    keys.withPrivateKey(accountId, (privateKey) => signEip155Digest({ privateKey, digest: DIGEST })),
  ).toThrow("Wallet is locked");
});
