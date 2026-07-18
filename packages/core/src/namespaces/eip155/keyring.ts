import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey } from "@scure/bip32";
import type { AccountId } from "../../accounts/accountId.js";
import { KeyringUnsupportedDerivationProfileError } from "../../keyring/errors.js";
import type { KeyringNamespaceAdapter } from "../../keyring/namespaceAdapter.js";
import type { PrivateKeySourceSecret } from "../../keyring/secrets.js";
import { Eip155SigningAccountMismatchError } from "./errors.js";
import { parsePrivateKeyBytes, privateKeyToEvmAddress } from "./keyringCrypto.js";

const DERIVATION_PREFIX = "m/44'/60'/0'/0";

const accountIdFromAddress = (address: string): AccountId => `eip155:${address.slice(2).toLowerCase()}`;

export type Eip155DigestSignature = Readonly<{
  r: bigint;
  s: bigint;
  yParity: number;
  bytes: Uint8Array;
}>;

/** Keeps derived private-key material inside a synchronous callback. */
const withHdPrivateKey = <T>(
  params: {
    seed: Uint8Array;
    derivationProfileId: string;
    derivationIndex: number;
  },
  use: (privateKey: Uint8Array) => T,
): T => {
  if (params.derivationProfileId !== "bip44") {
    throw new KeyringUnsupportedDerivationProfileError("eip155", params.derivationProfileId);
  }

  let root: HDKey | undefined;
  let node: HDKey | undefined;

  try {
    root = HDKey.fromMasterSeed(params.seed);
    node = root.derive(`${DERIVATION_PREFIX}/${params.derivationIndex}`);

    return use(node.privateKey as Uint8Array);
  } finally {
    node?.wipePrivateData();
    root?.wipePrivateData();
  }
};

const withImportedPrivateKey = <T>(source: PrivateKeySourceSecret, use: (privateKey: Uint8Array) => T): T => {
  const privateKey = parsePrivateKeyBytes(source.privateKey);
  try {
    return use(privateKey);
  } finally {
    privateKey.fill(0);
  }
};

const accountIdentity = (privateKey: Uint8Array) => ({
  accountId: accountIdFromAddress(privateKeyToEvmAddress(privateKey)),
});

const signDigest = (privateKey: Uint8Array, digest: Uint8Array): Eip155DigestSignature => {
  const signature = secp256k1.sign(digest, privateKey, { lowS: true });
  return {
    r: signature.r,
    s: signature.s,
    yParity: signature.recovery,
    bytes: signature.toCompactRawBytes(),
  };
};

const signAccountDigest = (
  privateKey: Uint8Array,
  requestedAccountId: AccountId,
  digest: Uint8Array,
): Eip155DigestSignature => {
  const actualAccountId = accountIdentity(privateKey).accountId;
  if (actualAccountId !== requestedAccountId) {
    throw new Eip155SigningAccountMismatchError(requestedAccountId, actualAccountId);
  }

  return signDigest(privateKey, digest);
};

export const eip155KeyringAdapter: KeyringNamespaceAdapter = {
  namespace: "eip155",
  defaultDerivationProfileId: "bip44",
  deriveAccount: (params) => withHdPrivateKey(params, accountIdentity),
  importPrivateKey: (source) => withImportedPrivateKey(source, accountIdentity),
};

export const signEip155HdDigest = (params: {
  accountId: AccountId;
  seed: Uint8Array;
  derivationProfileId: string;
  derivationIndex: number;
  digest: Uint8Array;
}): Eip155DigestSignature =>
  withHdPrivateKey(params, (privateKey) => signAccountDigest(privateKey, params.accountId, params.digest));

export const signEip155PrivateKeyDigest = (params: {
  accountId: AccountId;
  source: PrivateKeySourceSecret;
  digest: Uint8Array;
}): Eip155DigestSignature =>
  withImportedPrivateKey(params.source, (privateKey) => signAccountDigest(privateKey, params.accountId, params.digest));
