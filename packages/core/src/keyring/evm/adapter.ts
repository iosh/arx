import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import type { AccountId } from "../../accounts/addressing/accountId.js";
import {
  KeyringInvalidMnemonicError,
  KeyringSecretUnavailableError,
  KeyringUnsupportedDerivationProfileError,
} from "../errors.js";
import type { KeyringNamespaceAdapter } from "../namespaceAdapter.js";
import type { UnlockedSigner } from "../UnlockedSigners.js";
import { parsePrivateKeyBytes, privateKeyToEvmAddress } from "./evmCrypto.js";

const DERIVATION_PREFIX = "m/44'/60'/0'/0";

const accountIdFromAddress = (address: string): AccountId => `eip155:${address.slice(2).toLowerCase()}`;

const createSigner = (secretInput: Uint8Array): UnlockedSigner => {
  const secret = new Uint8Array(secretInput);
  const accountId = accountIdFromAddress(privateKeyToEvmAddress(secret));
  return {
    accountId,
    signDigest: async (digest) => {
      const signature = secp256k1.sign(digest, secret, { lowS: true });
      return {
        r: signature.r,
        s: signature.s,
        yParity: signature.recovery,
        bytes: signature.toCompactRawBytes(),
      };
    },
    clear: () => secret.fill(0),
  };
};

export const eip155KeyringAdapter: KeyringNamespaceAdapter = {
  namespace: "eip155",
  defaultDerivationProfileId: "bip44",
  deriveAccount: ({ source, derivationProfileId, derivationIndex }) => {
    if (derivationProfileId !== "bip44") {
      throw new KeyringUnsupportedDerivationProfileError("eip155", derivationProfileId);
    }
    if (!validateMnemonic(source.mnemonic, wordlist)) {
      throw new KeyringInvalidMnemonicError();
    }
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(source.mnemonic, source.passphrase));
    const node = root.derive(`${DERIVATION_PREFIX}/${derivationIndex}`);
    try {
      if (!node.privateKey) throw new KeyringSecretUnavailableError();
      return createSigner(node.privateKey);
    } finally {
      node.wipePrivateData();
      root.wipePrivateData();
    }
  },
  importPrivateKey: (source) => createSigner(parsePrivateKeyBytes(source.privateKey)),
};
