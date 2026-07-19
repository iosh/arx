import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { type AccountId, formatAccountId } from "../../accounts/accountId.js";
import type { KeyringNamespaceAdapter } from "../../keyring/namespaceAdapter.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { Eip155InvalidPrivateKeyError, Eip155SigningAccountMismatchError } from "./errors.js";

const DERIVATION_PREFIX = "m/44'/60'/0'/0";

export type Eip155DigestSignature = Readonly<{
  r: bigint;
  s: bigint;
  yParity: number;
  bytes: Uint8Array;
}>;

const deriveHdPrivateKey = (params: { seed: Uint8Array; derivationIndex: number }): Uint8Array => {
  const root = HDKey.fromMasterSeed(params.seed);
  const node = root.derive(`${DERIVATION_PREFIX}/${params.derivationIndex}`);

  return node.privateKey as Uint8Array;
};

const privateKeyBytes = (value: string): Uint8Array => {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!secp256k1.utils.isValidPrivateKey(hex)) {
    throw new Eip155InvalidPrivateKeyError();
  }

  return hexToBytes(hex);
};

const accountIdFromPrivateKeyBytes = (privateKey: Uint8Array): AccountId => {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const address = bytesToHex(keccak_256(publicKey.subarray(1)).slice(-20));

  return formatAccountId({ namespace: EIP155_NAMESPACE, payload: address });
};

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
  const actualAccountId = accountIdFromPrivateKeyBytes(privateKey);
  if (actualAccountId !== requestedAccountId) {
    throw new Eip155SigningAccountMismatchError(requestedAccountId, actualAccountId);
  }

  return signDigest(privateKey, digest);
};

export const eip155KeyringAdapter: KeyringNamespaceAdapter<"eip155"> = {
  namespace: EIP155_NAMESPACE,
  deriveHdAccountId: (params) => accountIdFromPrivateKeyBytes(deriveHdPrivateKey(params)),
  accountIdFromPrivateKey: (privateKey) => accountIdFromPrivateKeyBytes(privateKeyBytes(privateKey)),
};

export const signEip155HdDigest = (params: {
  accountId: AccountId;
  seed: Uint8Array;
  derivationIndex: number;
  digest: Uint8Array;
}): Eip155DigestSignature => signAccountDigest(deriveHdPrivateKey(params), params.accountId, params.digest);

export const signEip155PrivateKeyDigest = (params: {
  accountId: AccountId;
  privateKey: string;
  digest: Uint8Array;
}): Eip155DigestSignature => signAccountDigest(privateKeyBytes(params.privateKey), params.accountId, params.digest);
