import { accountIdFromChainAddress } from "../../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import type { ChainRef } from "../../chains/ids.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type {
  ConfirmNewMnemonicParams,
  ImportPrivateKeyParams,
  InitialHdKeyringDraft,
  InitialPrivateKeyKeyringDraft,
  KeyringService,
} from "../../runtime/keyring/KeyringService.js";

type InitialKeyringDraft = InitialHdKeyringDraft | InitialPrivateKeyKeyringDraft;

type SetupAvailability = "uninitialized" | "ready";

type SetupResult =
  | {
      keyringId: string;
      address: string;
    }
  | {
      keyringId: string;
      account: {
        address: string;
        derivationPath: null;
        derivationIndex: null;
        source: "imported";
      };
    };

type SetupDraftBuilder<TResult extends SetupResult> = {
  buildDraft(): InitialKeyringDraft;
  buildResult(draft: InitialKeyringDraft): TResult;
};

export type WalletSetupWorkflow = Readonly<{
  getStatus(): { availability: SetupAvailability };
  createWalletFromMnemonic(input: {
    password: string;
    mnemonic: string;
    alias?: string;
    skipBackup?: boolean;
    namespace: string;
    chainRef: ChainRef;
  }): Promise<{ keyringId: string; address: string }>;
  restoreWalletFromMnemonic(input: {
    password: string;
    mnemonic: string;
    alias?: string;
    namespace: string;
    chainRef: ChainRef;
  }): Promise<{ keyringId: string; address: string }>;
  restoreWalletFromPrivateKey(input: {
    password: string;
    privateKey: string;
    alias?: string;
    namespace: string;
    chainRef: ChainRef;
  }): Promise<{
    keyringId: string;
    account: {
      address: string;
      derivationPath: null;
      derivationIndex: null;
      source: "imported";
    };
  }>;
}>;

const hasAnyOwnedAccounts = (accounts: Pick<AccountSelectionService, "getState">): boolean => {
  const state = accounts.getState();
  return Object.values(state.namespaces).some((namespace) => (namespace?.accountIds.length ?? 0) > 0);
};

const deriveSetupAvailability = (accounts: Pick<AccountSelectionService, "getState">): SetupAvailability => {
  return hasAnyOwnedAccounts(accounts) ? "ready" : "uninitialized";
};

const assertSetupUninitialized = (accounts: Pick<AccountSelectionService, "getState">): void => {
  if (deriveSetupAvailability(accounts) !== "uninitialized") {
    throw new RpcInvalidRequestError({ message: "Wallet is already initialized" });
  }
};

const toAccountId = (input: {
  chainRef: ChainRef;
  address: string;
  accountAddressing: AccountAddressingByNamespace;
}) => {
  return accountIdFromChainAddress({
    accountAddressing: input.accountAddressing,
    chainRef: input.chainRef,
    address: input.address,
  });
};

const rollbackSelectedAccount = async (params: {
  accounts: Pick<AccountSelectionService, "setActiveAccount">;
  namespace: string;
  chainRef: ChainRef;
  previousAccountId: string | null;
}) => {
  await params.accounts.setActiveAccount({
    namespace: params.namespace,
    chainRef: params.chainRef,
    accountId: params.previousAccountId,
  });
};

const commitInitialSetup = async <TResult extends SetupResult>(params: {
  session: Pick<BackgroundSessionServices, "createVaultWithSecret" | "clearVault" | "persistVaultMeta" | "unlock">;
  keyring: Pick<
    KeyringService,
    | "buildInitialHdKeyring"
    | "buildInitialPrivateKeyKeyring"
    | "commitInitialKeyring"
    | "encodeInitialDraftPayload"
    | "removeCommittedInitialKeyring"
  >;
  accounts: Pick<AccountSelectionService, "getState" | "getSelectedAccountId" | "setActiveAccount" | "whenReady">;
  accountAddressing: AccountAddressingByNamespace;
  password: string;
  namespace: string;
  chainRef: ChainRef;
  draftBuilder: SetupDraftBuilder<TResult>;
}): Promise<TResult> => {
  assertSetupUninitialized(params.accounts);

  const previousSelectedAccountId = params.accounts.getSelectedAccountId(params.namespace);
  const draft = params.draftBuilder.buildDraft();
  const accountId = toAccountId({
    chainRef: params.chainRef,
    address: draft.defaultAccountAddress,
    accountAddressing: params.accountAddressing,
  });

  let committedKeyringId: string | null = null;
  let selectionWriteStarted = false;

  try {
    await params.session.createVaultWithSecret({
      password: params.password,
      secret: params.keyring.encodeInitialDraftPayload(draft),
    });

    await params.keyring.commitInitialKeyring(draft);
    committedKeyringId = draft.keyringId;

    await params.accounts.whenReady?.();
    selectionWriteStarted = true;
    await params.accounts.setActiveAccount({
      namespace: params.namespace,
      chainRef: params.chainRef,
      accountId,
    });
    await params.session.unlock.unlock({ password: params.password });
    await params.session.persistVaultMeta();

    return params.draftBuilder.buildResult(draft);
  } catch (error) {
    if (selectionWriteStarted) {
      await rollbackSelectedAccount({
        accounts: params.accounts,
        namespace: params.namespace,
        chainRef: params.chainRef,
        previousAccountId: previousSelectedAccountId,
      });
    }

    if (committedKeyringId) {
      await params.keyring.removeCommittedInitialKeyring(committedKeyringId);
    }

    await params.session.clearVault();
    throw error;
  }
};

export const createWalletSetupWorkflow = (deps: {
  session: Pick<BackgroundSessionServices, "createVaultWithSecret" | "clearVault" | "persistVaultMeta" | "unlock">;
  keyring: Pick<
    KeyringService,
    | "buildInitialHdKeyring"
    | "buildInitialPrivateKeyKeyring"
    | "commitInitialKeyring"
    | "encodeInitialDraftPayload"
    | "removeCommittedInitialKeyring"
  >;
  accounts: Pick<AccountSelectionService, "getState" | "getSelectedAccountId" | "setActiveAccount" | "whenReady">;
  accountAddressing: AccountAddressingByNamespace;
}): WalletSetupWorkflow => {
  return {
    getStatus: () => ({ availability: deriveSetupAvailability(deps.accounts) }),
    createWalletFromMnemonic: async (input) => {
      const command: ConfirmNewMnemonicParams = {
        mnemonic: input.mnemonic,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        ...(input.skipBackup !== undefined ? { skipBackup: input.skipBackup } : {}),
        namespace: input.namespace,
      };

      return await commitInitialSetup({
        ...deps,
        password: input.password,
        namespace: input.namespace,
        chainRef: input.chainRef,
        draftBuilder: {
          buildDraft: () => deps.keyring.buildInitialHdKeyring(command),
          buildResult: (draft) => ({
            keyringId: draft.keyringId,
            address: draft.defaultAccountAddress,
          }),
        },
      });
    },
    restoreWalletFromMnemonic: async (input) => {
      const command: ConfirmNewMnemonicParams = {
        mnemonic: input.mnemonic,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        namespace: input.namespace,
        skipBackup: true,
      };

      return await commitInitialSetup({
        ...deps,
        password: input.password,
        namespace: input.namespace,
        chainRef: input.chainRef,
        draftBuilder: {
          buildDraft: () => deps.keyring.buildInitialHdKeyring(command),
          buildResult: (draft) => ({
            keyringId: draft.keyringId,
            address: draft.defaultAccountAddress,
          }),
        },
      });
    },
    restoreWalletFromPrivateKey: async (input) => {
      const command: ImportPrivateKeyParams = {
        privateKey: input.privateKey,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        namespace: input.namespace,
      };

      return await commitInitialSetup({
        ...deps,
        password: input.password,
        namespace: input.namespace,
        chainRef: input.chainRef,
        draftBuilder: {
          buildDraft: () => deps.keyring.buildInitialPrivateKeyKeyring(command),
          buildResult: (draft) => ({
            keyringId: draft.keyringId,
            account: {
              address: draft.defaultAccountAddress,
              derivationPath: null,
              derivationIndex: null,
              source: "imported" as const,
            },
          }),
        },
      });
    },
  };
};
