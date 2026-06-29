import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateMnemonic as BIP39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { isArxBaseError } from "../../error.js";
import {
  KeyringAccountNotFoundError,
  KeyringDuplicateAccountError,
  KeyringIndexOutOfRangeError,
  KeyringInvalidAddressError,
  KeyringInvalidMnemonicError,
  KeyringSecretUnavailableError,
} from "../../keyring/errors.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import { KEYRING_VAULT_ENTRY_VERSION } from "../../storage/keyringSchemas.js";
import { AccountKeySchema, type AccountRecord } from "../../storage/records.js";
import { zeroize } from "../../utils/bytes.js";
import { SessionLockedError } from "../session/errors.js";
import { encodePayload } from "./keyring-utils.js";
import type { KeyringKind, NamespaceConfig } from "./namespaces.js";
import { RuntimeKeyringState } from "./RuntimeKeyringState.js";
import type {
  AccountKey,
  InitialHdKeyringDraft,
  InitialPrivateKeyKeyringDraft,
  KeyringMetaRecord,
  KeyringPayloadListener,
  KeyringServiceOptions,
  KeyringStateListener,
  VaultKeyringEntry,
} from "./types.js";

export type ConfirmNewMnemonicParams = {
  mnemonic: string;
  alias?: string;
  skipBackup?: boolean;
  namespace?: string;
};

export type ImportMnemonicParams = {
  mnemonic: string;
  alias?: string;
  namespace?: string;
};

export type ImportPrivateKeyParams = {
  privateKey: string | Uint8Array;
  alias?: string;
  namespace?: string;
};

export type { InitialHdKeyringDraft, InitialPrivateKeyKeyringDraft } from "./types.js";

export class KeyringService {
  #options: KeyringServiceOptions;
  #namespacesConfig: Map<string, NamespaceConfig>;
  #runtimeKeyringState: RuntimeKeyringState;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    this.#namespacesConfig = new Map(options.namespaces.map((ns) => [ns.namespace, ns]));
    this.#runtimeKeyringState = new RuntimeKeyringState(options);
  }

  async attach() {
    await this.#runtimeKeyringState.attach();
  }

  detach() {
    this.#runtimeKeyringState.detach();
  }

  async waitForReady(): Promise<void> {
    await this.#runtimeKeyringState.waitForReady();
  }

  onPayloadUpdated(handler: KeyringPayloadListener): () => void {
    return this.#runtimeKeyringState.onPayloadUpdated(handler);
  }

  onStateChanged(handler: KeyringStateListener): () => void {
    return this.#runtimeKeyringState.onStateChanged(handler);
  }

  hasNamespace(namespace: string): boolean {
    return this.#namespacesConfig.has(namespace);
  }

  getNamespaces(): NamespaceConfig[] {
    return Array.from(this.#namespacesConfig.values());
  }

  getKeyrings(): KeyringMetaRecord[] {
    return this.#runtimeKeyringState.getKeyrings();
  }

  getAccounts(includeHidden = false): AccountRecord[] {
    return this.#runtimeKeyringState.getAccounts(includeHidden);
  }

  getAccountsByKeyring(keyringId: string, includeHidden = false): AccountRecord[] {
    return this.#runtimeKeyringState.getAccountsByKeyring(keyringId, includeHidden);
  }

  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const strength = wordCount === 24 ? 256 : 128;
    return BIP39Generate(wordlist, strength);
  }

  async confirmNewMnemonic(params: ConfirmNewMnemonicParams) {
    await this.#waitForUnlockedRuntimeKeyrings();
    return this.#createHdKeyringFromMnemonic(params);
  }

  async importMnemonic(params: ImportMnemonicParams) {
    await this.#waitForUnlockedRuntimeKeyrings();
    return this.#createHdKeyringFromMnemonic(params);
  }

  async importPrivateKey(params: ImportPrivateKeyParams) {
    await this.#waitForUnlockedRuntimeKeyrings();
    const draft = this.#buildInitialPrivateKeyKeyring(params);

    await this.#persistNewKeyring({
      keyringId: draft.keyringId,
      kind: draft.kind,
      namespace: draft.namespace,
      instance: draft.instance,
      meta: draft.meta,
      accounts: draft.accounts,
      payloadEntry: draft.payloadEntry,
    });

    const [record] = draft.accounts;
    if (!record) {
      throw new KeyringSecretUnavailableError();
    }

    return {
      keyringId: draft.keyringId,
      account: {
        address: draft.defaultAccountAddress,
        derivationPath: null,
        derivationIndex: null,
        source: "imported" as const,
      },
    };
  }

  buildInitialHdKeyring(params: ConfirmNewMnemonicParams): InitialHdKeyringDraft {
    return this.#buildInitialHdKeyring(params);
  }

  buildInitialPrivateKeyKeyring(params: ImportPrivateKeyParams): InitialPrivateKeyKeyringDraft {
    return this.#buildInitialPrivateKeyKeyring(params);
  }

  async commitInitialKeyring(draft: InitialHdKeyringDraft | InitialPrivateKeyKeyringDraft): Promise<void> {
    await this.#persistNewKeyring({
      keyringId: draft.keyringId,
      kind: draft.kind,
      namespace: draft.namespace,
      instance: draft.instance,
      meta: draft.meta,
      accounts: draft.accounts,
      payloadEntry: draft.payloadEntry,
    });
  }

  async removeCommittedInitialKeyring(keyringId: string): Promise<void> {
    await this.#removeKeyring({ keyringId });
  }

  encodeInitialDraftPayload(draft: InitialHdKeyringDraft | InitialPrivateKeyKeyringDraft): Uint8Array {
    return encodePayload({
      keyrings: [structuredClone(draft.payloadEntry)],
    });
  }

  async deriveAccount(keyringId: string) {
    await this.#waitForUnlockedRuntimeKeyrings();

    const runtime = this.#runtimeKeyringState.getRuntimeKeyring(keyringId);
    if (!runtime) throw new Error(`Keyring "${keyringId}" not found`);
    if (runtime.kind !== "hd") throw new KeyringIndexOutOfRangeError();

    const meta = this.#runtimeKeyringState.getKeyringMeta(keyringId);
    if (!meta) throw new Error(`Keyring metadata missing for ${keyringId}`);

    const instance = runtime.instance as HierarchicalDeterministicKeyring;

    const index = this.#resolveNextDerivationIndex(keyringId, meta);
    const derived = instance.deriveAccount(index);

    const canonical = this.#toCanonicalString(runtime.namespace, derived.address);
    const accountKey = this.#toAccountKey(runtime.namespace, canonical);
    this.#assertNoDuplicate(accountKey);

    const now = this.#options.now();
    const record = this.#buildAccountRecord({
      namespace: runtime.namespace,
      address: canonical,
      keyringId,
      createdAt: now,
      derivationIndex: index,
    });

    const nextMeta: KeyringMetaRecord = {
      ...meta,
      nextDerivationIndex: index + 1,
    };

    // Persist metadata first; the vault payload is already present.
    await this.#options.accountsStore.upsert(record);
    await this.#options.keyringMetas.upsert(nextMeta);

    this.#runtimeKeyringState.replaceAccountRecord(record);
    this.#runtimeKeyringState.replaceKeyringMeta(nextMeta);

    return { ...derived, address: canonical };
  }

  async hideHdAccount(accountKey: AccountKey): Promise<void> {
    await this.#setAccountHidden(accountKey, true);
  }

  async unhideHdAccount(accountKey: AccountKey): Promise<void> {
    await this.#setAccountHidden(accountKey, false);
  }

  async renameKeyring(keyringId: string, alias: string): Promise<void> {
    const meta = this.#runtimeKeyringState.getKeyringMeta(keyringId);
    if (!meta) return;

    const next: KeyringMetaRecord = { ...meta, alias };
    await this.#options.keyringMetas.upsert(next);
    this.#runtimeKeyringState.replaceKeyringMeta(next);
  }

  async renameAccount(accountKey: AccountKey, alias: string): Promise<void> {
    const record = this.#runtimeKeyringState.getAccount(accountKey);
    if (!record) return;

    const next: AccountRecord = { ...record, alias };
    await this.#options.accountsStore.upsert(next);
    this.#runtimeKeyringState.replaceAccountRecord(next, false);
  }

  async markBackedUp(keyringId: string): Promise<void> {
    const meta = this.#runtimeKeyringState.getKeyringMeta(keyringId);
    if (!meta) return;
    if (meta.type !== "hd") return;

    const next: KeyringMetaRecord = { ...meta, needsBackup: false };
    await this.#options.keyringMetas.upsert(next);
    this.#runtimeKeyringState.replaceKeyringMeta(next);
  }

  async removePrivateKeyKeyring(keyringId: string): Promise<void> {
    await this.#waitForHydration();

    const runtime = this.#runtimeKeyringState.getRuntimeKeyring(keyringId);
    const meta = this.#runtimeKeyringState.getKeyringMeta(keyringId);

    if (!runtime && !meta) return;
    if (runtime?.kind !== "private-key" && meta?.type !== "private-key") {
      throw new KeyringIndexOutOfRangeError();
    }

    await this.#removeKeyring({ keyringId });
  }

  async removeAccount(namespace: string, address: string): Promise<void> {
    await this.#waitForHydration();

    const canonical = this.#toCanonicalString(namespace, address);
    const accountKey = this.#toAccountKey(namespace, canonical);
    const record = this.#runtimeKeyringState.getAccount(accountKey);
    if (!record) throw new KeyringAccountNotFoundError();

    const meta = this.#runtimeKeyringState.getKeyringMeta(record.keyringId);
    if (!meta) {
      // Orphaned account metadata; drop it.
      await this.#options.accountsStore.remove(record.accountKey);
      this.#runtimeKeyringState.dropAccountRecord(record.accountKey, false);
      return;
    }

    if (meta.type === "private-key") {
      await this.#removeKeyring({ keyringId: record.keyringId });
      return;
    }

    await this.#options.accountsStore.remove(record.accountKey);
    this.#runtimeKeyringState.dropAccountRecord(record.accountKey, false);
  }

  async exportMnemonic(keyringId: string, password: string): Promise<string> {
    await this.#waitForUnlockedRuntimeKeyrings();
    await this.#verifyPassword(password);
    this.#requireUnlockedSession();

    const entry = this.#runtimeKeyringState.getPayloadEntry(keyringId);
    if (!entry || entry.type !== "hd") throw new KeyringAccountNotFoundError();
    const payload = entry.payload as { mnemonic: string[]; passphrase?: string };
    return payload.mnemonic.join(" ");
  }

  async exportPrivateKey(namespace: string, address: string, password: string): Promise<Uint8Array> {
    await this.#waitForUnlockedRuntimeKeyrings();
    await this.#verifyPassword(password);
    return this.#exportPrivateKeyFromUnlockedRuntime(namespace, address);
  }

  hasAccount(namespace: string, address: string): boolean {
    const canonical = this.#toCanonicalString(namespace, address);
    const accountKey = this.#toAccountKey(namespace, canonical);
    return this.hasAccountKey(accountKey);
  }

  hasAccountKey(accountKey: AccountKey): boolean {
    return this.#runtimeKeyringState.hasAccountKey(accountKey);
  }

  async exportPrivateKeyByAccountKey(accountKey: AccountKey, password: string): Promise<Uint8Array> {
    await this.#waitForUnlockedRuntimeKeyrings();
    await this.#verifyPassword(password);
    return this.#exportPrivateKeyByAccountKeyFromUnlockedRuntime(accountKey);
  }

  async signDigestByAccountKey(params: { accountKey: AccountKey; digest: Uint8Array }): Promise<{
    r: bigint;
    s: bigint;
    yParity: number;
    bytes: Uint8Array;
  }> {
    const { accountKey, digest } = params;
    await this.#waitForUnlockedRuntimeKeyrings();

    if (digest.length !== 32) {
      throw new Error(`signDigestByAccountKey expects a 32-byte digest, got ${digest.length}`);
    }

    const secret = this.#exportPrivateKeyByAccountKeyFromUnlockedRuntime(accountKey);
    try {
      const signature = secp256k1.sign(digest, secret, { lowS: true });
      return {
        r: signature.r,
        s: signature.s,
        yParity: signature.recovery,
        bytes: signature.toCompactRawBytes(),
      };
    } finally {
      zeroize(secret);
    }
  }

  // ----- private helpers -----

  async #waitForHydration(): Promise<void> {
    await this.#runtimeKeyringState.waitForReady();
  }

  async #waitForUnlockedRuntimeKeyrings(): Promise<void> {
    this.#requireUnlockedSession();
    await this.#waitForHydration();
    this.#requireUnlockedSession();
  }

  #requireUnlockedSession(): void {
    if (!this.#options.unlock.isUnlocked()) {
      throw new SessionLockedError();
    }
  }

  async #verifyPassword(password: string) {
    try {
      await this.#options.vault.verifyPassword(password);
    } catch (error) {
      if (isArxBaseError(error) && error.code === "vault.invalid_password") throw error;
      throw error;
    }
  }

  async #createHdKeyringFromMnemonic(params: ConfirmNewMnemonicParams) {
    const draft = this.#buildInitialHdKeyring(params);

    await this.#persistNewKeyring({
      keyringId: draft.keyringId,
      kind: draft.kind,
      namespace: draft.namespace,
      instance: draft.instance,
      meta: draft.meta,
      accounts: draft.accounts,
      payloadEntry: draft.payloadEntry,
    });

    return { keyringId: draft.keyringId, address: draft.defaultAccountAddress };
  }

  #buildInitialHdKeyring(params: ConfirmNewMnemonicParams): InitialHdKeyringDraft {
    const normalized = params.mnemonic.trim().replace(/\s+/g, " ");
    if (!validateMnemonic(normalized, wordlist)) {
      throw new KeyringInvalidMnemonicError();
    }

    const namespace = params.namespace ?? this.#defaultNamespace();
    const payload = this.#runtimeKeyringState.getPayload();

    const existingHd = payload.keyrings.find(
      (entry) =>
        entry.type === "hd" &&
        (entry.namespace ?? this.#defaultNamespace()) === namespace &&
        Array.isArray((entry.payload as { mnemonic?: unknown[] }).mnemonic) &&
        (entry.payload as { mnemonic: string[] }).mnemonic.join(" ") === normalized,
    );

    if (existingHd) {
      throw new KeyringDuplicateAccountError();
    }

    const words = normalized.split(" ");
    const config = this.#getConfig(namespace);
    const factory = config.factories.hd;
    if (!factory) throw new Error(`Namespace "${namespace}" does not support hd keyring`);

    const instance = factory();
    instance.loadFromMnemonic(normalized);
    const first = instance.deriveNextAccount();

    const canonical = this.#toCanonicalString(namespace, first.address);
    const accountKey = this.#toAccountKey(namespace, canonical);
    this.#assertNoDuplicate(accountKey);

    const now = this.#options.now();
    const keyringId = this.#options.uuid();

    return {
      keyringId,
      kind: "hd",
      namespace,
      instance,
      defaultAccountAddress: canonical,
      payloadEntry: {
        keyringId,
        type: "hd",
        createdAt: now,
        version: KEYRING_VAULT_ENTRY_VERSION,
        namespace,
        payload: { mnemonic: words, passphrase: undefined },
      },
      meta: {
        id: keyringId,
        type: "hd",
        alias: params.alias,
        needsBackup: !params.skipBackup,
        nextDerivationIndex: 1,
        createdAt: now,
      },
      accounts: [
        this.#buildAccountRecord({
          namespace,
          address: canonical,
          keyringId,
          createdAt: now,
          derivationIndex: 0,
          alias: params.alias,
        }),
      ],
    };
  }

  #buildInitialPrivateKeyKeyring(params: ImportPrivateKeyParams): InitialPrivateKeyKeyringDraft {
    const namespace = params.namespace ?? this.#defaultNamespace();
    const config = this.#getConfig(namespace);
    const factory = config.factories["private-key"];
    if (!factory) throw new Error(`Namespace "${namespace}" does not support private-key keyring`);

    const instance = factory();
    instance.loadFromPrivateKey(params.privateKey);
    const [account] = instance.getAccounts();
    if (!account) throw new KeyringSecretUnavailableError();

    const canonical = this.#toCanonicalString(namespace, account.address);
    const accountKey = this.#toAccountKey(namespace, canonical);
    this.#assertNoDuplicate(accountKey);

    const now = this.#options.now();
    const keyringId = this.#options.uuid();

    const secret = instance.exportPrivateKey(canonical);
    const secretHex = bytesToHex(secret);
    zeroize(secret);

    return {
      keyringId,
      kind: "private-key",
      namespace,
      instance,
      defaultAccountAddress: canonical,
      payloadEntry: {
        keyringId,
        type: "private-key",
        createdAt: now,
        version: KEYRING_VAULT_ENTRY_VERSION,
        namespace,
        payload: { privateKey: secretHex },
      },
      meta: {
        id: keyringId,
        type: "private-key",
        alias: params.alias,
        createdAt: now,
      },
      accounts: [
        this.#buildAccountRecord({
          namespace,
          address: canonical,
          keyringId,
          createdAt: now,
          alias: params.alias,
        }),
      ],
    };
  }

  async #persistNewKeyring(params: {
    keyringId: string;
    kind: KeyringKind;
    namespace: string;
    instance: HierarchicalDeterministicKeyring | SimpleKeyring;
    meta: KeyringMetaRecord;
    accounts: AccountRecord[];
    payloadEntry: VaultKeyringEntry;
  }) {
    // Persist metadata before updating the encrypted vault payload; this keeps hydration safe if a write fails.
    await this.#options.keyringMetas.upsert(params.meta);
    for (const record of params.accounts) {
      await this.#options.accountsStore.upsert(record);
    }

    await this.#runtimeKeyringState.commitPersistedKeyring(params);
  }

  async #removeKeyring(params: { keyringId: string }): Promise<void> {
    const { keyringId } = params;

    await this.#runtimeKeyringState.dropKeyring(keyringId);
    await this.#options.keyringMetas.remove(keyringId);
    await this.#options.accountsStore.removeByKeyringId(keyringId);
  }

  #exportPrivateKeyFromUnlockedRuntime(namespace: string, address: string): Uint8Array {
    this.#requireUnlockedSession();

    const canonical = this.#toCanonicalString(namespace, address);
    const accountKey = this.#toAccountKey(namespace, canonical);
    const record = this.#runtimeKeyringState.getAccount(accountKey);
    if (!record) throw new KeyringAccountNotFoundError();

    const indexed = this.#runtimeKeyringState.getAccountRef(accountKey);
    if (!indexed) throw new KeyringSecretUnavailableError();

    const runtime = this.#runtimeKeyringState.getRuntimeKeyring(indexed.keyringId);
    if (!runtime) throw new KeyringSecretUnavailableError();

    return runtime.instance.exportPrivateKey(canonical);
  }

  #exportPrivateKeyByAccountKeyFromUnlockedRuntime(accountKey: AccountKey): Uint8Array {
    this.#requireUnlockedSession();

    const record = this.#runtimeKeyringState.getAccount(accountKey);
    if (!record) throw new KeyringAccountNotFoundError();

    const indexed = this.#runtimeKeyringState.getAccountRef(accountKey);
    if (!indexed) throw new KeyringSecretUnavailableError();

    const runtime = this.#runtimeKeyringState.getRuntimeKeyring(indexed.keyringId);
    if (!runtime) throw new KeyringSecretUnavailableError();

    const config = this.#getConfig(indexed.namespace);
    const canonical = config.codec.fromAccountKey(accountKey);
    const canonicalString = config.codec.toCanonicalString({ canonical });
    return runtime.instance.exportPrivateKey(canonicalString);
  }

  async #setAccountHidden(accountKey: AccountKey, hidden: boolean): Promise<void> {
    await this.#waitForHydration();

    const record = this.#runtimeKeyringState.getAccount(accountKey);
    if (!record) return;
    if (record.derivationIndex === undefined) {
      // Imported accounts (private-key) are not hideable in this UX.
      return;
    }

    const next: AccountRecord = {
      ...record,
      hidden: hidden ? true : undefined,
    };

    await this.#options.accountsStore.upsert(next);
    this.#runtimeKeyringState.replaceAccountRecord(next, false);
  }

  #resolveNextDerivationIndex(keyringId: string, meta: KeyringMetaRecord): number {
    const known = this.#runtimeKeyringState.getAccountsByKeyring(keyringId, true);
    const maxIndex = Math.max(-1, ...known.map((a) => a.derivationIndex ?? -1));
    const expected = maxIndex + 1;
    const current = meta.nextDerivationIndex ?? 0;
    return Math.max(current, expected);
  }

  #assertNoDuplicate(accountKey: AccountKey): void {
    if (this.#runtimeKeyringState.getAccount(accountKey)) {
      throw new KeyringDuplicateAccountError();
    }
  }

  #buildAccountRecord(params: {
    namespace: string;
    address: string;
    keyringId: string;
    createdAt: number;
    alias?: string | undefined;
    derivationIndex?: number;
  }): AccountRecord {
    const config = this.#getConfig(params.namespace);
    const canonical = this.#toCanonicalAddress(params.namespace, params.address);
    const accountKey = AccountKeySchema.parse(config.codec.toAccountKey(canonical));

    return {
      accountKey,
      namespace: params.namespace,
      keyringId: params.keyringId,
      derivationIndex: params.derivationIndex,
      alias: params.alias,
      createdAt: params.createdAt,
    };
  }

  #toCanonicalAddress(namespace: string, address: string) {
    const config = this.#getConfig(namespace);
    try {
      return config.codec.toCanonicalAddress({ chainRef: config.defaultChainRef, value: address });
    } catch {
      throw new KeyringInvalidAddressError();
    }
  }

  #toCanonicalString(namespace: string, address: string): string {
    const config = this.#getConfig(namespace);
    const canonical = this.#toCanonicalAddress(namespace, address);
    return config.codec.toCanonicalString({ canonical });
  }

  #toAccountKey(namespace: string, address: string): AccountKey {
    const canonical = this.#toCanonicalAddress(namespace, address);
    const config = this.#getConfig(namespace);
    return AccountKeySchema.parse(config.codec.toAccountKey(canonical));
  }

  #defaultNamespace(): string {
    const [first] = this.#options.namespaces;
    if (!first) throw new Error("No keyring namespace configured");
    return first.namespace;
  }

  #getConfig(namespace: string): NamespaceConfig {
    const config = this.#namespacesConfig.get(namespace);
    if (!config) throw new Error(`Namespace "${namespace}" is not supported`);
    return config;
  }
}
