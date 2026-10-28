import { type BackupStatus, KeyringInvalidMnemonicError } from "@arx/core/keyring";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useMutation } from "@tanstack/react-query";
import { Navigate, useBlocker, useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmAccountMoveSheet } from "@/ui/components/accounts/ConfirmAccountMoveSheet";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Spinner } from "@/ui/components/ui/spinner";
import { UnlockForm } from "@/ui/components/unlock-form/UnlockForm";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicSources } from "@/ui/wallet/keyring/useMnemonicSources";
import { useNetworkSelection } from "@/ui/wallet/networks/useNetworkSelection";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { MnemonicBackup } from "./mnemonic/MnemonicBackup";
import { MnemonicForm } from "./mnemonic/MnemonicForm";
import { type MnemonicFields, type MnemonicWord, mnemonicDefaultValues, mnemonicFromFields } from "./mnemonic/mnemonic";
import { type AddMnemonicWalletContext, useAddMnemonicWallet } from "./useAddMnemonicWallet";

type AdditionMode = "create" | "import";
const exitLocation = { to: "/onboarding", replace: true, ignoreBlocker: true } as const;

export function AddMnemonicWalletPage({ mode }: { mode: AdditionMode }) {
  const { status } = useWallet();
  const { t } = useTranslation("onboarding");

  if (status === "uninitialized") return <Navigate to="/onboarding" replace />;
  if (status === "locked") {
    return (
      <OnboardingStepLayout>
        <OnboardingCard
          title={t(mode === "create" ? "createWallet" : "importRecoveryPhrase")}
          description={t("unlockToAddWallet")}
        >
          <UnlockForm focusPassword />
        </OnboardingCard>
      </OnboardingStepLayout>
    );
  }
  return <MnemonicWalletAddition mode={mode} />;
}

function MnemonicWalletAddition({ mode }: { mode: AdditionMode }) {
  const { t } = useTranslation(["onboarding", "wallet"]);
  const navigate = useNavigate();
  const { data: mnemonicSources, isPending: sourcesPending } = useMnemonicSources();
  const { data: network, isPending: networkPending } = useNetworkSelection();
  const sources = mnemonicSources?.sources;

  if (!sources || !network) {
    return (
      <OnboardingStepLayout>
        <OnboardingCard title={t(mode === "create" ? "createWallet" : "importRecoveryPhrase")}>
          {(sourcesPending || networkPending) && <Spinner aria-label={t("wallet:loadingWallet")} />}
        </OnboardingCard>
      </OnboardingStepLayout>
    );
  }

  const context: AddMnemonicWalletContext = {
    sources,
    namespace: network.selectedNamespace,
    onAdded: () => void navigate(exitLocation),
  };
  return mode === "create" ? <NewMnemonicWallet {...context} /> : <ImportMnemonicWallet {...context} />;
}

function NewMnemonicWallet(context: AddMnemonicWalletContext) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("onboarding");
  const flow = useAddMnemonicWallet(context);
  const generation = useMutation({ mutationFn: wallet.keySources.generateMnemonic, gcTime: 0 });
  const { mutate: generateMnemonic } = generation;

  useBlocker({ shouldBlockFn: () => flow.isAdding, enableBeforeUnload: false });

  useEffect(() => {
    generateMnemonic();
  }, [generateMnemonic]);
  if (!generation.data) {
    return (
      <OnboardingStepLayout progress={{ current: 1, total: 2 }}>
        <OnboardingCard title={t("backupTitle")} description={t("backupDescription")}>
          {generation.isPending && <Spinner aria-label={t("createWallet")} />}
        </OnboardingCard>
      </OnboardingStepLayout>
    );
  }

  const mnemonic = generation.data.mnemonic;
  const words: readonly MnemonicWord[] = mnemonic.split(" ").map((word, index) => ({ position: index + 1, word }));

  function add(backupStatus: BackupStatus, returnFocusElement?: HTMLElement | null) {
    const deferred = backupStatus === "pending";

    return flow.add(
      { mnemonic, backupStatus },
      {
        returnFocusElement,
        onDuplicate: (walletName) => {
          toast.error(t("phraseAlreadyImported", { walletName }), {
            duration: Infinity,
            closeButton: true,
            toasterId: deferred ? "defer-backup" : undefined,
          });
        },
      },
    );
  }

  return (
    <>
      <MnemonicBackup
        words={words}
        totalSteps={2}
        pending={flow.isAdding || flow.move !== null}
        onComplete={() => void add("confirmed").catch(() => undefined)}
        onDefer={(trigger) =>
          add("pending", trigger).then(
            (result) => result.status === "added" || result.status === "move-available",
            () => false,
          )
        }
      />
      <MnemonicAccountMoveSheet move={flow.move} returnFocusRef={flow.returnFocusRef} />
    </>
  );
}

function ImportMnemonicWallet(context: AddMnemonicWalletContext) {
  const { t } = useTranslation("onboarding");
  const form = useForm<MnemonicFields>({ defaultValues: mnemonicDefaultValues });
  const flow = useAddMnemonicWallet(context);
  const reportError = useWalletError();
  const pending = form.formState.isSubmitting;

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  function showDuplicateWallet(walletName: string) {
    form.setError("root.mnemonic", {
      type: "duplicate",
      message: t("phraseAlreadyImported", { walletName }),
    });
  }

  function handleImportError(error: unknown) {
    if (isWalletApiError(error, KeyringInvalidMnemonicError)) form.setError("root.mnemonic", { type: "invalid" });
    else reportError(error);
  }

  async function importWallet(fields: MnemonicFields) {
    await flow
      .add(
        { mnemonic: mnemonicFromFields(fields), backupStatus: "confirmed" },
        {
          onDuplicate: showDuplicateWallet,
          onError: handleImportError,
        },
      )
      .catch(() => undefined);
  }

  return (
    <>
      <MnemonicForm form={form} onSubmit={importWallet} disabled={flow.move !== null} />
      <MnemonicAccountMoveSheet move={flow.move} returnFocusRef={flow.returnFocusRef} />
    </>
  );
}

function MnemonicAccountMoveSheet({
  move,
  returnFocusRef,
}: {
  move: ReturnType<typeof useAddMnemonicWallet>["move"];
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation("wallet");
  if (!move) return null;

  return (
    <ConfirmAccountMoveSheet
      account={move.account}
      walletName={move.walletName}
      description={t("firstAccountMoveDescription", {
        accountName: getAccountName(move.account, t),
        walletName: move.walletName,
      })}
      className="inset-x-auto top-1/2 bottom-auto left-1/2 w-[calc(100%-3rem)] max-w-onboarding -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 sm:p-8"
      isPending={move.isPending}
      onCancel={move.cancel}
      onConfirm={move.confirm}
      returnFocusRef={returnFocusRef}
    />
  );
}
