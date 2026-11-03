import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assert, describe, expect, it } from "vitest";
import type { AccountId } from "../../accounts/accountId.js";
import type { AccountMemberRecord } from "../../accounts/persistence.js";
import { Keyring } from "../../keyring/Keyring.js";
import type { HdKeyringRecord, KeySourceRecord } from "../../keyring/persistence.js";
import { createKeyringSecrets, encodeKeyringSecrets, type KeySourceSecret } from "../../keyring/secrets.js";
import { createCoreMutationQueue } from "../../persistence/mutationQueue.js";
import { createUnlockedVault } from "../../vault/crypto.js";
import type { WalletStatusReader } from "../../wallet/Wallet.js";
import { createEip155AccountSigning } from "./accountSigning.js";
import { Eip155SigningAccountMismatchError } from "./errors.js";
import { type Eip155DigestSignature, eip155KeyringAdapter } from "./keyring.js";

const DIGEST = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PRIVATE_ACCOUNT_ID = "eip155:fcad0b19bb29d4674531d6f115237e16afce377c";
const HD_ACCOUNT_ID = "eip155:f3f50213c1d2e255e4b2bad430f8a38eef8d718e";
const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const recoverAccountId = (signature: Eip155DigestSignature): AccountId => {
  const publicKey = secp256k1.Signature.fromCompact(signature.bytes)
    .addRecoveryBit(signature.yParity)
    .recoverPublicKey(DIGEST)
    .toRawBytes(false);
  const address = bytesToHex(keccak_256(publicKey.subarray(1)).slice(-20));
  return `eip155:${address}`;
};

const createSigningFixture = async (params: {
  account: AccountMemberRecord;
  source: KeySourceSecret;
  hdKeyring?: HdKeyringRecord;
}) => {
  const sourceRecord: KeySourceRecord =
    params.source.type === "bip39"
      ? {
          keySourceId: params.source.keySourceId,
          type: "bip39",
          name: "Wallet 1",
          backupStatus: "confirmed",
          createdAt: 1,
        }
      : {
          keySourceId: params.source.keySourceId,
          type: "private-key",
          namespace: "eip155",
          createdAt: 1,
        };
  const encrypted = await createUnlockedVault({
    password: "password",
    plaintext: encodeKeyringSecrets(createKeyringSecrets([params.source])),
  });
  const mutations = createCoreMutationQueue({ commit: async () => {} });
  const keyring = new Keyring({
    bootstrap: {
      encryptedVault: encrypted.record,
      keySources: [sourceRecord],
      hdKeyrings: params.hdKeyring ? [params.hdKeyring] : [],
    },
    namespaceAdapters: { eip155: eip155KeyringAdapter },
    mutations,
    publishChanged: () => {},
  });
  await mutations.run(async () => {
    const unlocked = await keyring.prepareUnlock("password");
    assert(unlocked !== null);
    unlocked.activate();
  });

  const wallet = { getStatus: () => keyring.getSoftwareKeyStatus() } satisfies WalletStatusReader;
  const signing = createEip155AccountSigning({
    keyring,
    wallet,
    accounts: {
      getMemberRecord: (accountId) => (accountId === params.account.accountId ? params.account : null),
    },
  });

  return { keyring, signing };
};

describe("Eip155AccountSigning", () => {
  it("signs with the requested private key only while the wallet session is valid", async () => {
    const source: KeySourceSecret = {
      keySourceId: "private-source",
      type: "private-key",
      privateKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const account: AccountMemberRecord = {
      accountGroupId: "signing-group",
      accountId: PRIVATE_ACCOUNT_ID,
      origin: { type: "private-key", keySourceId: source.keySourceId },
    };
    const { signing, keyring } = await createSigningFixture({ account, source });

    const signature = await signing.signDigest({ accountId: account.accountId, digest: DIGEST });

    expect(recoverAccountId(signature)).toBe(PRIVATE_ACCOUNT_ID);

    keyring.lock();
    await expect(signing.signDigest({ accountId: account.accountId, digest: DIGEST })).rejects.toMatchObject({
      code: "wallet.locked",
    });
  });

  it("signs with the requested HD derivation index", async () => {
    const source: KeySourceSecret = {
      keySourceId: "mnemonic-source",
      type: "bip39",
      mnemonic: MNEMONIC,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      createdAt: 1,
    };
    const account: AccountMemberRecord = {
      accountGroupId: "signing-group",
      accountId: HD_ACCOUNT_ID,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 3 },
    };
    const { signing } = await createSigningFixture({ account, source, hdKeyring });

    const signature = await signing.signDigest({ accountId: account.accountId, digest: DIGEST });

    expect(recoverAccountId(signature)).toBe(HD_ACCOUNT_ID);
  });

  it("does not finish an HD signature after the keyring locks", async () => {
    const source: KeySourceSecret = {
      keySourceId: "mnemonic-source",
      type: "bip39",
      mnemonic: MNEMONIC,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      createdAt: 1,
    };
    const account: AccountMemberRecord = {
      accountGroupId: "signing-group",
      accountId: HD_ACCOUNT_ID,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 3 },
    };
    const { signing, keyring } = await createSigningFixture({ account, source, hdKeyring });

    const pendingSignature = signing.signDigest({ accountId: account.accountId, digest: DIGEST });
    keyring.lock();

    await expect(pendingSignature).rejects.toMatchObject({ code: "wallet.locked" });
  });

  it("rejects an imported-key record that points at a different account", async () => {
    const source: KeySourceSecret = {
      keySourceId: "private-source",
      type: "private-key",
      privateKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const account: AccountMemberRecord = {
      accountGroupId: "signing-group",
      accountId: HD_ACCOUNT_ID,
      origin: { type: "private-key", keySourceId: source.keySourceId },
    };
    const { signing } = await createSigningFixture({ account, source });

    await expect(signing.signDigest({ accountId: account.accountId, digest: DIGEST })).rejects.toMatchObject({
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId: HD_ACCOUNT_ID, actualAccountId: PRIVATE_ACCOUNT_ID },
    });
  });

  it("rejects an HD record that derives a different account", async () => {
    const source: KeySourceSecret = {
      keySourceId: "mnemonic-source",
      type: "bip39",
      mnemonic: MNEMONIC,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      createdAt: 1,
    };
    const account: AccountMemberRecord = {
      accountGroupId: "signing-group",
      accountId: PRIVATE_ACCOUNT_ID,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 3 },
    };
    const { signing } = await createSigningFixture({ account, source, hdKeyring });

    await expect(signing.signDigest({ accountId: account.accountId, digest: DIGEST })).rejects.toMatchObject({
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId: PRIVATE_ACCOUNT_ID, actualAccountId: HD_ACCOUNT_ID },
    });
  });
});
