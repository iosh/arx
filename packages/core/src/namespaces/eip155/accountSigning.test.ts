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

const recoverAccountId = (signature: Eip155DigestSignature): AccountId => {
  const publicKey = secp256k1.Signature.fromCompact(signature.bytes)
    .addRecoveryBit(signature.yParity)
    .recoverPublicKey(DIGEST)
    .toRawBytes(false);
  const address = bytesToHex(keccak_256(publicKey.subarray(1)).slice(-20));
  return `eip155:${address}`;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const createSigningFixture = (params: {
  account: AccountRecord;
  source: KeySourceSecret;
  sourceRecord?: KeySourceRecord;
  hdKeyring?: HdKeyringRecord;
}) => {
  const keyring = new Keyring();
  keyring.activate(createKeyringSecrets([params.source]));

  const signing = createEip155AccountSigning({
    keyring,
    accounts: {
      get: async (accountId) => (accountId === params.account.accountId ? params.account : null),
    },
    keySources: {
      get: async (keySourceId) => (params.sourceRecord?.keySourceId === keySourceId ? params.sourceRecord : null),
    },
    hdKeyrings: {
      get: async (keyringId) => (params.hdKeyring?.keyringId === keyringId ? params.hdKeyring : null),
    },
  });

  return { keyring, signing };
};

describe("Eip155AccountSigning", () => {
  it("signs with the imported private key selected by account metadata", async () => {
    const source: KeySourceSecret = {
      keySourceId: "private-source",
      type: "private-key",
      privateKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const account: AccountRecord = {
      accountId: PRIVATE_ACCOUNT_ID,
      origin: { type: "private-key", keySourceId: source.keySourceId },
      hidden: false,
      createAt: 1,
    };
    const { signing } = createSigningFixture({
      account,
      source,
      sourceRecord: {
        keySourceId: source.keySourceId,
        type: "private-key",
        namespace: "eip155",
        createAt: 1,
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
      mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    };
    const hdKeyring: HdKeyringRecord = {
      keyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      derivationProfileId: "bip44",
      nextDerivationIndex: 4,
      createAt: 1,
    };
    const account: AccountRecord = {
      accountId: HD_ACCOUNT_ID,
      origin: { type: "hd", keyringId: hdKeyring.keyringId, derivationIndex: 3 },
      hidden: false,
      createAt: 1,
    };
    const { signing } = createSigningFixture({ account, source, hdKeyring });

    const signature = await signing.signDigest({ accountId: account.accountId, digest: DIGEST });

    expect(signature.bytes).toHaveLength(64);
    expect(recoverAccountId(signature)).toBe(HD_ACCOUNT_ID);
  });

  it("rejects imported-key metadata that points at a different account", async () => {
    const source: KeySourceSecret = {
      keySourceId: "private-source",
      type: "private-key",
      privateKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const account: AccountRecord = {
      accountId: HD_ACCOUNT_ID,
      origin: { type: "private-key", keySourceId: source.keySourceId },
      hidden: false,
      createAt: 1,
    };
    const { signing } = createSigningFixture({
      account,
      source,
      sourceRecord: {
        keySourceId: source.keySourceId,
        type: "private-key",
        namespace: "eip155",
        createAt: 1,
      },
    });

    await expect(signing.signDigest({ accountId: account.accountId, digest: DIGEST })).rejects.toMatchObject({
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId: HD_ACCOUNT_ID, actualAccountId: PRIVATE_ACCOUNT_ID },
    });
  });

  it("rejects HD metadata that derives a different account", async () => {
    const source: KeySourceSecret = {
      keySourceId: "mnemonic-source",
      type: "bip39",
      mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    };
    const hdKeyring: HdKeyringRecord = {
      keyringId: "hd-keyring",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      derivationProfileId: "bip44",
      nextDerivationIndex: 4,
      createAt: 1,
    };
    const account: AccountRecord = {
      accountId: PRIVATE_ACCOUNT_ID,
      origin: { type: "hd", keyringId: hdKeyring.keyringId, derivationIndex: 3 },
      hidden: false,
      createAt: 1,
    };
    const { signing } = createSigningFixture({ account, source, hdKeyring });

    await expect(signing.signDigest({ accountId: account.accountId, digest: DIGEST })).rejects.toMatchObject({
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId: PRIVATE_ACCOUNT_ID, actualAccountId: HD_ACCOUNT_ID },
    });
  });

  it("observes a lock that happens while account metadata is loading", async () => {
    const source: KeySourceSecret = {
      keySourceId: "private-source",
      type: "private-key",
      privateKey: "1111111111111111111111111111111111111111111111111111111111111111",
    };
    const account: AccountRecord = {
      accountId: "eip155:19e7e376e7c213b7e7e7e46cc70a5dd086daff2a",
      origin: { type: "private-key", keySourceId: source.keySourceId },
      hidden: false,
      createAt: 1,
    };
    const accountRead = deferred<AccountRecord | null>();
    const keyring = new Keyring();
    keyring.activate(createKeyringSecrets([source]));
    const signing = createEip155AccountSigning({
      keyring,
      accounts: { get: async () => await accountRead.promise },
      keySources: {
        get: async () => ({
          keySourceId: source.keySourceId,
          type: "private-key",
          namespace: "eip155",
          createAt: 1,
        }),
      },
      hdKeyrings: { get: async () => null },
    });

    const pendingSignature = signing.signDigest({ accountId: account.accountId, digest: DIGEST });
    keyring.lock();
    accountRead.resolve(account);

    await expect(pendingSignature).rejects.toMatchObject({ code: "wallet.locked" });
  });
});
