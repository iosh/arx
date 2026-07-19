import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import type { AccountId } from "../../accounts/accountId.js";
import type { AccountRecord } from "../../accounts/persistence.js";
import { Keyring } from "../../keyring/Keyring.js";
import type { HdKeyringRecord, KeySourceRecord } from "../../keyring/persistence.js";
import { createKeyringSecrets, type KeySourceSecret } from "../../keyring/secrets.js";
import { createEip155AccountSigning } from "./accountSigning.js";
import { Eip155SigningAccountMismatchError } from "./errors.js";
import type { Eip155DigestSignature } from "./keyring.js";

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

const createSigningFixture = (params: {
  account: AccountRecord;
  source: KeySourceSecret;
  sourceRecord?: KeySourceRecord;
  hdKeyring?: HdKeyringRecord;
}) => {
  const sourceRecord =
    params.sourceRecord ??
    (params.source.type === "bip39"
      ? {
          keySourceId: params.source.keySourceId,
          type: "bip39" as const,
          backupStatus: "confirmed" as const,
          createdAt: 1,
        }
      : undefined);
  const keyring = new Keyring({
    bootstrap: {
      keySources: sourceRecord ? [sourceRecord] : [],
      hdKeyrings: params.hdKeyring ? [params.hdKeyring] : [],
    },
  });
  keyring.activateSecrets(createKeyringSecrets([params.source]));

  const signing = createEip155AccountSigning({
    keyring,
    accounts: {
      getAccountRecord: (accountId) => (accountId === params.account.accountId ? params.account : null),
    },
  });

  return { keyring, signing };
};

describe("Eip155AccountSigning", () => {
  it("signs with the imported private key selected by the account record", async () => {
    const source: KeySourceSecret = {
      keySourceId: "private-source",
      type: "private-key",
      privateKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const account: AccountRecord = {
      accountId: PRIVATE_ACCOUNT_ID,
      origin: { type: "private-key", keySourceId: source.keySourceId },
      hidden: false,
      createdAt: 1,
    };
    const { signing } = createSigningFixture({
      account,
      source,
      sourceRecord: {
        keySourceId: source.keySourceId,
        type: "private-key",
        namespace: "eip155",
        createdAt: 1,
      },
    });

    const signature = await signing.signDigest({ accountId: account.accountId, digest: DIGEST });

    expect(signature.bytes).toHaveLength(64);
    expect(recoverAccountId(signature)).toBe(PRIVATE_ACCOUNT_ID);
  });

  it("derives the requested HD account only for the signature", async () => {
    const source: KeySourceSecret = {
      keySourceId: "mnemonic-source",
      type: "bip39",
      mnemonic: MNEMONIC,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      nextDerivationIndex: 4,
      createdAt: 1,
    };
    const account: AccountRecord = {
      accountId: HD_ACCOUNT_ID,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 3 },
      hidden: false,
      createdAt: 1,
    };
    const { signing } = createSigningFixture({ account, source, hdKeyring });

    const signature = await signing.signDigest({ accountId: account.accountId, digest: DIGEST });

    expect(signature.bytes).toHaveLength(64);
    expect(recoverAccountId(signature)).toBe(HD_ACCOUNT_ID);
  });

  it("does not finish an HD signature after the keyring is locked", async () => {
    const source: KeySourceSecret = {
      keySourceId: "mnemonic-source",
      type: "bip39",
      mnemonic: MNEMONIC,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      nextDerivationIndex: 4,
      createdAt: 1,
    };
    const account: AccountRecord = {
      accountId: HD_ACCOUNT_ID,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 3 },
      hidden: false,
      createdAt: 1,
    };
    const { keyring, signing } = createSigningFixture({ account, source, hdKeyring });

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
    const account: AccountRecord = {
      accountId: HD_ACCOUNT_ID,
      origin: { type: "private-key", keySourceId: source.keySourceId },
      hidden: false,
      createdAt: 1,
    };
    const { signing } = createSigningFixture({
      account,
      source,
      sourceRecord: {
        keySourceId: source.keySourceId,
        type: "private-key",
        namespace: "eip155",
        createdAt: 1,
      },
    });

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
      nextDerivationIndex: 4,
      createdAt: 1,
    };
    const account: AccountRecord = {
      accountId: PRIVATE_ACCOUNT_ID,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 3 },
      hidden: false,
      createdAt: 1,
    };
    const { signing } = createSigningFixture({ account, source, hdKeyring });

    await expect(signing.signDigest({ accountId: account.accountId, digest: DIGEST })).rejects.toMatchObject({
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId: PRIVATE_ACCOUNT_ID, actualAccountId: HD_ACCOUNT_ID },
    });
  });
});
