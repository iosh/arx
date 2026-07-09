import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateMnemonic as BIP39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { parseAccountId } from "../../accounts/addressing/accountId.js";
import { SessionLockedError } from "../../session/errors.js";
import type { HdVaultPayload } from "../../storage/keyringSchemas.js";
import { KEYRING_VAULT_ENTRY_VERSION } from "../../storage/keyringSchemas.js";
import type { AccountRecord } from "../../storage/records.js";
import {
  KeyringAccountNotFoundError,
  KeyringDuplicateAccountError,
  KeyringHydrationAccountMismatchError,
  KeyringHydrationAccountMissingError,
  KeyringIndexOutOfRangeError,
  KeyringInvalidMnemonicError,
  KeyringInvalidSigningPayloadError,
  KeyringMetadataMissingError,
  KeyringNamespaceConfigRequiredError,
  KeyringNotFoundError,
  KeyringPrivateKeyAccountCountError,
  KeyringSecretUnavailableError,
  KeyringUnsupportedNamespaceError,
} from "../errors.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../types.js";
import type { KeyringKind, NamespaceConfig } from "./namespaceConfig.js";
import type {
  AccountId,
  InitialHdKeyringDraft,
  InitialPrivateKeyKeyringDraft,
  KeyringMetaRecord,
  KeyringPayloadListener,
  KeyringServiceOptions,
  KeyringStateListener,
  UnlockedKeyring,
  VaultKeyringEntry,
} from "./types.js";
import { UnlockedKeyringState } from "./UnlockedKeyringState.js";
import { encodePayload } from "./vaultPayloadCodec.js";

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

type HdVaultEntry = VaultKeyringEntry & { type: "hd"; payload: HdVaultPayload };

export type { InitialHdKeyringDraft, InitialPrivateKeyKeyringDraft } from "./types.js";

export class KeyringService {
  #options: KeyringServiceOptions;
  #defaultNamespace: string;
  #namespacesConfig: Map<string, NamespaceConfig>;
  #unlockedKeyrings: UnlockedKeyringState;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    const [firstNamespace] = options.namespaces;
    if (!firstNamespace) {
      throw new KeyringNamespaceConfigRequiredError();
    }
    this.#defaultNamespace = firstNamespace.namespace;
    this.#namespacesConfig = new Map(options.namespaces.map((ns) => [ns.namespace, ns]));
    this.#unlockedKeyrings = new UnlockedKeyringState(options, (entry, accounts) =>
      this.#buildUnlockedKeyring(entry, accounts),
    );
  }

  async attach() {
    await this.#unlockedKeyrings.attach();
  }

  detach() {
    this.#unlockedKeyrings.detach();
  }

  async waitForReady(): Promise<void> {
    await this.#unlockedKeyrings.waitForReady();
  }

  onPayloadUpdated(handler: KeyringPayloadListener): () => void {
    return this.#unlockedKeyrings.onPayloadUpdated(handler);
  }

  onStateChanged(handler: KeyringStateListener): () => void {
    return this.#unlockedKeyrings.onStateChanged(handler);
  }

  hasNamespace(namespace: string): boolean {
    return this.#namespacesConfig.has(namespace);
  }

  getNamespaces(): NamespaceConfig[] {
    return Array.from(this.#namespacesConfig.values());
  }

  getKeyrings(): KeyringMetaRecord[] {
    return this.#unlockedKeyrings.getKeyrings();
  }

  getAccounts(includeHidden = false): AccountRecord[] {
    return this.#unlockedKeyrings.getAccounts(includeHidden);
  }

  getAccountsByKeyring(keyringId: string, includeHidden = false): AccountRecord[] {
    return this.#unlockedKeyrings.getAccountsByKeyring(keyringId, includeHidden);
  }

  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const strength = wordCount === 24 ? 256 : 128;
    return BIP39Generate(wordlist, strength);
  }

  async confirmNewMnemonic(params: ConfirmNewMnemonicParams) {
    await this.#waitForUnlockedKeyrings();
    return this.#createHdKeyringFromMnemonic(params);
  }

  async importMnemonic(params: ImportMnemonicParams) {
    await this.#waitForUnlockedKeyrings();
    return this.#createHdKeyringFromMnemonic(params);
  }

  async importPrivateKey(params: ImportPrivateKeyParams) {
    await this.#waitForUnlockedKeyrings();
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
    await this.#persistNewKeyring(
      {
        keyringId: draft.keyringId,
        kind: draft.kind,
        namespace: draft.namespace,
        instance: draft.instance,
        meta: draft.meta,
        accounts: draft.accounts,
        payloadEntry: draft.payloadEntry,
      },
      { notifyPayloadUpdated: false },
    );
  }

  async removeCommittedInitialKeyring(keyringId: string): Promise<void> {
    await this.#removeKeyring({ keyringId }, { notifyPayloadUpdated: false });
  }

  encodeInitialDraftPayload(draft: InitialHdKeyringDraft | InitialPrivateKeyKeyringDraft): Uint8Array {
    return encodePayload({
      keyrings: [structuredClone(draft.payloadEntry)],
    });
  }

  async deriveAccount(keyringId: string) {
    await this.#waitForUnlockedKeyrings();

    const unlockedKeyring = this.#unlockedKeyrings.getUnlockedKeyring(keyringId);
    if (!unlockedKeyring) throw new KeyringNotFoundError(keyringId);
    if (unlockedKeyring.kind !== "hd") throw new KeyringIndexOutOfRangeError();

    const meta = this.#unlockedKeyrings.getKeyringMeta(keyringId);
    if (!meta) throw new KeyringMetadataMissingError(keyringId);

    const instance = unlockedKeyring.instance as HierarchicalDeterministicKeyring;

    const index = this.#resolveNextDerivationIndex(keyringId, meta);
    const derived = instance.deriveAccount(index);

    const canonical = this.#toCanonicalString(unlockedKeyring.namespace, derived.address);
    const accountId = this.#toAccountId(unlockedKeyring.namespace, canonical);
    this.#assertNoDuplicate(accountId);

    const now = Date.now();
    const record = this.#buildAccountRecord({
      namespace: unlockedKeyring.namespace,
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

    this.#unlockedKeyrings.replaceAccountRecord(record);
    this.#unlockedKeyrings.replaceKeyringMeta(nextMeta);

    return { ...derived, address: canonical };
  }

  async hideHdAccount(accountId: AccountId): Promise<void> {
    await this.#setAccountHidden(accountId, true);
  }

  async unhideHdAccount(accountId: AccountId): Promise<void> {
    await this.#setAccountHidden(accountId, false);
  }

  async renameKeyring(keyringId: string, alias: string): Promise<void> {
    const meta = this.#unlockedKeyrings.getKeyringMeta(keyringId);
    if (!meta) return;

    const next: KeyringMetaRecord = { ...meta, alias };
    await this.#options.keyringMetas.upsert(next);
    this.#unlockedKeyrings.replaceKeyringMeta(next);
  }

  async renameAccount(accountId: AccountId, alias: string): Promise<void> {
    const record = this.#unlockedKeyrings.getAccount(accountId);
    if (!record) return;

    const next: AccountRecord = { ...record, alias };
    await this.#options.accountsStore.upsert(next);
    this.#unlockedKeyrings.replaceAccountRecord(next, false);
  }

  async markBackedUp(keyringId: string): Promise<void> {
    const meta = this.#unlockedKeyrings.getKeyringMeta(keyringId);
    if (!meta) return;
    if (meta.type !== "hd") return;

    const next: KeyringMetaRecord = { ...meta, needsBackup: false };
    await this.#options.keyringMetas.upsert(next);
    this.#unlockedKeyrings.replaceKeyringMeta(next);
  }

  async removePrivateKeyKeyring(keyringId: string): Promise<void> {
    await this.#waitForHydration();

    const unlockedKeyring = this.#unlockedKeyrings.getUnlockedKeyring(keyringId);
    const meta = this.#unlockedKeyrings.getKeyringMeta(keyringId);

    if (!unlockedKeyring && !meta) return;
    if (unlockedKeyring?.kind !== "private-key" && meta?.type !== "private-key") {
      throw new KeyringIndexOutOfRangeError();
    }

    await this.#removeKeyring({ keyringId });
  }

  async removeAccount(namespace: string, address: string): Promise<void> {
    await this.#waitForHydration();

    const canonical = this.#toCanonicalString(namespace, address);
    const accountId = this.#toAccountId(namespace, canonical);
    const record = this.#unlockedKeyrings.getAccount(accountId);
    if (!record) throw new KeyringAccountNotFoundError();

    const meta = this.#unlockedKeyrings.getKeyringMeta(record.keyringId);
    if (!meta) {
      // Orphaned account metadata; drop it.
      await this.#options.accountsStore.remove(record.accountId);
      this.#unlockedKeyrings.dropAccountRecord(record.accountId, false);
      return;
    }

    if (meta.type === "private-key") {
      await this.#removeKeyring({ keyringId: record.keyringId });
      return;
    }

    await this.#options.accountsStore.remove(record.accountId);
    this.#unlockedKeyrings.dropAccountRecord(record.accountId, false);
  }

  async exportMnemonic(keyringId: string, password: string): Promise<string> {
    await this.#waitForUnlockedKeyrings();
    await this.#options.vault.verifyPassword(password);
    this.#requireUnlockedSession();

    const entry = this.#unlockedKeyrings.getPayloadEntry(keyringId);
    if (!entry || entry.type !== "hd") throw new KeyringAccountNotFoundError();
    const payload = entry.payload as { mnemonic: string[]; passphrase?: string };
    return payload.mnemonic.join(" ");
  }

  async exportPrivateKey(namespace: string, address: string, password: string): Promise<Uint8Array> {
    await this.#waitForUnlockedKeyrings();
    await this.#options.vault.verifyPassword(password);
    return this.#exportPrivateKeyFromUnlockedKeyring(namespace, address);
  }

  hasAccount(namespace: string, address: string): boolean {
    const canonical = this.#toCanonicalString(namespace, address);
    const accountId = this.#toAccountId(namespace, canonical);
    return this.hasAccountId(accountId);
  }

  hasAccountId(accountId: AccountId): boolean {
    return this.#unlockedKeyrings.hasAccountId(accountId);
  }

  async exportPrivateKeyByAccountId(accountId: AccountId, password: string): Promise<Uint8Array> {
    await this.#waitForUnlockedKeyrings();
    await this.#options.vault.verifyPassword(password);
    return this.#exportPrivateKeyByAccountIdFromUnlockedKeyring(accountId);
  }

  async signDigestByAccountId(params: { accountId: AccountId; digest: Uint8Array }): Promise<{
    r: bigint;
    s: bigint;
    yParity: number;
    bytes: Uint8Array;
  }> {
    const { accountId, digest } = params;
    await this.#waitForUnlockedKeyrings();

    if (digest.length !== 32) {
      throw new KeyringInvalidSigningPayloadError(digest.length);
    }

    const secret = this.#exportPrivateKeyByAccountIdFromUnlockedKeyring(accountId);
    const signature = secp256k1.sign(digest, secret, { lowS: true });
    return {
      r: signature.r,
      s: signature.s,
      yParity: signature.recovery,
      bytes: signature.toCompactRawBytes(),
    };
  }

  // ----- private helpers -----

  async #waitForHydration(): Promise<void> {
    await this.#unlockedKeyrings.waitForReady();
  }

  async #waitForUnlockedKeyrings(): Promise<void> {
    this.#requireUnlockedSession();
    await this.#waitForHydration();
    this.#requireUnlockedSession();
  }

  #requireUnlockedSession(): void {
    if (!this.#options.unlock.isUnlocked()) {
      throw new SessionLockedError();
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

    const defaultNamespace = this.#defaultNamespace;
    const namespace = params.namespace ?? defaultNamespace;
    const payload = this.#unlockedKeyrings.getPayload();

    const existingHd = payload.keyrings.find((entry) => {
      if (entry.type !== "hd") return false;
      const hdEntry = entry as HdVaultEntry;
      if ((entry.namespace ?? defaultNamespace) !== namespace) return false;
      const { mnemonic } = hdEntry.payload;
      return Array.isArray(mnemonic) && mnemonic.join(" ") === normalized;
    });

    if (existingHd) {
      throw new KeyringDuplicateAccountError();
    }

    const words = normalized.split(" ");
    const config = this.#getConfig(namespace);
    const instance = config.factories.hd();
    instance.loadFromMnemonic(normalized);
    const first = instance.deriveNextAccount();

    const canonical = this.#toCanonicalString(namespace, first.address);
    const accountId = this.#toAccountId(namespace, canonical);
    this.#assertNoDuplicate(accountId);

    const now = Date.now();
    const keyringId = crypto.randomUUID();

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
    const namespace = params.namespace ?? this.#defaultNamespace;
    const config = this.#getConfig(namespace);
    const instance = config.factories["private-key"]();
    instance.loadFromPrivateKey(params.privateKey);
    const [account] = instance.getAccounts();
    if (!account) throw new KeyringSecretUnavailableError();

    const canonical = this.#toCanonicalString(namespace, account.address);
    const accountId = this.#toAccountId(namespace, canonical);
    this.#assertNoDuplicate(accountId);

    const now = Date.now();
    const keyringId = crypto.randomUUID();

    const secret = instance.exportPrivateKey(canonical);
    const secretHex = bytesToHex(secret);

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

  #buildUnlockedKeyring(entry: VaultKeyringEntry, accounts: readonly AccountRecord[]): UnlockedKeyring {
    const namespace = entry.namespace ?? this.#defaultNamespace;
    const config = this.#getConfig(namespace);
    const instance = config.factories[entry.type]();

    if (entry.type === "hd") {
      this.#loadHdUnlockedKeyring({
        entry,
        config,
        instance: instance as HierarchicalDeterministicKeyring,
        accounts,
      });
    } else {
      this.#loadPrivateKeyUnlockedKeyring({
        entry,
        config,
        instance: instance as SimpleKeyring,
        accounts,
      });
    }

    return {
      id: entry.keyringId,
      kind: entry.type,
      namespace,
      instance,
    };
  }

  #loadHdUnlockedKeyring(params: {
    entry: VaultKeyringEntry;
    config: NamespaceConfig;
    instance: HierarchicalDeterministicKeyring;
    accounts: readonly AccountRecord[];
  }): void {
    const { entry, config, instance, accounts } = params;
    const hdPayload = entry.payload as { mnemonic?: string[]; passphrase?: string };
    if (!Array.isArray(hdPayload.mnemonic)) {
      throw new KeyringSecretUnavailableError();
    }

    instance.loadFromMnemonic(
      hdPayload.mnemonic.join(" "),
      hdPayload.passphrase ? { passphrase: hdPayload.passphrase } : undefined,
    );

    const derivedAccounts = accounts
      .filter((account) => account.keyringId === entry.keyringId && account.derivationIndex !== undefined)
      .sort((left, right) => (left.derivationIndex ?? 0) - (right.derivationIndex ?? 0));

    for (const account of derivedAccounts) {
      const derived = instance.deriveAccount(account.derivationIndex ?? 0);
      const payloadHex = config.accountAddressing.accountIdPayloadFromAddress({
        chainRef: config.defaultChainRef,
        address: derived.address,
      });
      const expectedAccountId = `${config.namespace}:${payloadHex}`;
      if (expectedAccountId !== account.accountId) {
        throw new KeyringHydrationAccountMismatchError({
          keyringId: entry.keyringId,
          accountId: account.accountId,
          namespace: config.namespace,
          keyringKind: entry.type,
        });
      }
    }
  }

  #loadPrivateKeyUnlockedKeyring(params: {
    entry: VaultKeyringEntry;
    config: NamespaceConfig;
    instance: SimpleKeyring;
    accounts: readonly AccountRecord[];
  }): void {
    const { entry, config, instance, accounts } = params;
    const privateKeyPayload = entry.payload as { privateKey?: string };
    if (typeof privateKeyPayload.privateKey !== "string") {
      throw new KeyringSecretUnavailableError();
    }

    instance.loadFromPrivateKey(privateKeyPayload.privateKey);

    const persistedAccounts = accounts.filter((account) => account.keyringId === entry.keyringId);
    if (persistedAccounts.length !== 1) {
      throw new KeyringPrivateKeyAccountCountError({
        keyringId: entry.keyringId,
        namespace: config.namespace,
        actualCount: persistedAccounts.length,
      });
    }
    const persistedAccount = persistedAccounts[0];
    if (!persistedAccount) {
      throw new KeyringHydrationAccountMissingError({
        keyringId: entry.keyringId,
        namespace: config.namespace,
        keyringKind: entry.type,
      });
    }

    const [unlockedAccount] = instance.getAccounts();
    if (!unlockedAccount) {
      throw new KeyringSecretUnavailableError();
    }

    const payloadHex = config.accountAddressing.accountIdPayloadFromAddress({
      chainRef: config.defaultChainRef,
      address: unlockedAccount.address,
    });
    const expectedAccountId = `${config.namespace}:${payloadHex}`;
    if (persistedAccount.accountId !== expectedAccountId) {
      throw new KeyringHydrationAccountMismatchError({
        keyringId: entry.keyringId,
        accountId: persistedAccount.accountId,
        namespace: config.namespace,
        keyringKind: entry.type,
      });
    }
  }

  async #persistNewKeyring(
    params: {
      keyringId: string;
      kind: KeyringKind;
      namespace: string;
      instance: HierarchicalDeterministicKeyring | SimpleKeyring;
      meta: KeyringMetaRecord;
      accounts: AccountRecord[];
      payloadEntry: VaultKeyringEntry;
    },
    options: { notifyPayloadUpdated?: boolean } = {},
  ) {
    // Persist metadata before updating the encrypted vault payload; this keeps hydration safe if a write fails.
    await this.#options.keyringMetas.upsert(params.meta);
    for (const record of params.accounts) {
      await this.#options.accountsStore.upsert(record);
    }

    await this.#unlockedKeyrings.commitPersistedKeyring(params, options);
  }

  async #removeKeyring(params: { keyringId: string }, options: { notifyPayloadUpdated?: boolean } = {}): Promise<void> {
    const { keyringId } = params;

    await this.#unlockedKeyrings.dropKeyring(keyringId, options);
    await this.#options.keyringMetas.remove(keyringId);
    await this.#options.accountsStore.removeByKeyringId(keyringId);
  }

  #exportPrivateKeyFromUnlockedKeyring(namespace: string, address: string): Uint8Array {
    this.#requireUnlockedSession();

    const canonical = this.#toCanonicalString(namespace, address);
    const accountId = this.#toAccountId(namespace, canonical);
    const record = this.#unlockedKeyrings.getAccount(accountId);
    if (!record) throw new KeyringAccountNotFoundError();

    const indexed = this.#unlockedKeyrings.getAccountRef(accountId);
    if (!indexed) throw new KeyringSecretUnavailableError();

    const unlockedKeyring = this.#unlockedKeyrings.getUnlockedKeyring(indexed.keyringId);
    if (!unlockedKeyring) throw new KeyringSecretUnavailableError();

    return unlockedKeyring.instance.exportPrivateKey(canonical);
  }

  #exportPrivateKeyByAccountIdFromUnlockedKeyring(accountId: AccountId): Uint8Array {
    this.#requireUnlockedSession();

    const record = this.#unlockedKeyrings.getAccount(accountId);
    if (!record) throw new KeyringAccountNotFoundError();

    const indexed = this.#unlockedKeyrings.getAccountRef(accountId);
    if (!indexed) throw new KeyringSecretUnavailableError();

    const unlockedKeyring = this.#unlockedKeyrings.getUnlockedKeyring(indexed.keyringId);
    if (!unlockedKeyring) throw new KeyringSecretUnavailableError();

    const config = this.#getConfig(indexed.namespace);
    const { payloadHex } = parseAccountId(accountId);
    const canonicalString = config.accountAddressing.canonicalAddressFromAccountIdPayload({
      chainRef: config.defaultChainRef,
      payloadHex,
    });
    return unlockedKeyring.instance.exportPrivateKey(canonicalString);
  }

  async #setAccountHidden(accountId: AccountId, hidden: boolean): Promise<void> {
    await this.#waitForHydration();

    const record = this.#unlockedKeyrings.getAccount(accountId);
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
    this.#unlockedKeyrings.replaceAccountRecord(next, false);
  }

  #resolveNextDerivationIndex(keyringId: string, meta: KeyringMetaRecord): number {
    const known = this.#unlockedKeyrings.getAccountsByKeyring(keyringId, true);
    const maxIndex = Math.max(-1, ...known.map((a) => a.derivationIndex ?? -1));
    const expected = maxIndex + 1;
    const current = meta.nextDerivationIndex ?? 0;
    return Math.max(current, expected);
  }

  #assertNoDuplicate(accountId: AccountId): void {
    if (this.#unlockedKeyrings.getAccount(accountId)) {
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
    const payloadHex = this.#accountIdPayloadFromAddress(params.namespace, params.address);
    const accountId = `${params.namespace}:${payloadHex}`;

    return {
      accountId,
      keyringId: params.keyringId,
      derivationIndex: params.derivationIndex,
      alias: params.alias,
      createdAt: params.createdAt,
    };
  }

  #accountIdPayloadFromAddress(namespace: string, address: string): string {
    const config = this.#getConfig(namespace);
    return config.accountAddressing.accountIdPayloadFromAddress({ chainRef: config.defaultChainRef, address });
  }

  #toCanonicalString(namespace: string, address: string): string {
    const config = this.#getConfig(namespace);
    const payloadHex = this.#accountIdPayloadFromAddress(namespace, address);
    return config.accountAddressing.canonicalAddressFromAccountIdPayload({
      chainRef: config.defaultChainRef,
      payloadHex,
    });
  }

  #toAccountId(namespace: string, address: string): AccountId {
    const payloadHex = this.#accountIdPayloadFromAddress(namespace, address);
    return `${namespace}:${payloadHex}`;
  }

  #getConfig(namespace: string): NamespaceConfig {
    const config = this.#namespacesConfig.get(namespace);
    if (!config) throw new KeyringUnsupportedNamespaceError(namespace);
    return config;
  }
}
