import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { HARDENED_OFFSET, HDKey } from "@scure/bip32";
import type { KeyringNamespaceAdapter } from "../../keyring/namespaceAdapter.js";
import { accountIdFromAddress } from "./accounts.js";
import { EIP155_NAMESPACE } from "./constants.js";

export type Eip155DigestSignature = Readonly<{ r: bigint; s: bigint; yParity: number }>;

const derivePrivateKey = ({ seed, accountIndex }: { seed: Uint8Array; accountIndex: number }): Uint8Array => {
  let node = HDKey.fromMasterSeed(seed);
  try {
    // BIP44 m/44'/60'/0'/0/index. Wipe each parent instead of retaining intermediate private keys.
    for (const index of [44 + HARDENED_OFFSET, 60 + HARDENED_OFFSET, HARDENED_OFFSET, 0, accountIndex]) {
      const parent = node;
      node = parent.deriveChild(index);
      parent.wipePrivateData();
    }
    const privateKey = node.privateKey;
    if (!privateKey) throw new Error("BIP44 derivation did not produce a private key.");
    return privateKey.slice();
  } finally {
    node.wipePrivateData();
  }
};

export const eip155KeyringAdapter: KeyringNamespaceAdapter<"eip155"> = {
  namespace: EIP155_NAMESPACE,
  parsePrivateKey(input) {
    const hex = input.startsWith("0x") ? input.slice(2) : input;
    return secp256k1.utils.isValidPrivateKey(hex) ? hexToBytes(hex) : null;
  },
  formatPrivateKey: (privateKey) => `0x${bytesToHex(privateKey)}`,
  accountIdFromPrivateKey(privateKey) {
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    const address = bytesToHex(keccak_256(publicKey.subarray(1)).slice(-20));
    return accountIdFromAddress(`0x${address}`);
  },
  derivePrivateKey,
};

export const signEip155Digest = ({
  privateKey,
  digest,
}: {
  privateKey: Uint8Array;
  digest: Uint8Array;
}): Eip155DigestSignature => {
  const signature = secp256k1.sign(digest, privateKey, { lowS: true });
  return { r: signature.r, s: signature.s, yParity: signature.recovery };
};
