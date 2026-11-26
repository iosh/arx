import { type BackupStatus, KeyringInvalidMnemonicError } from "@arx/core/keyring";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useMutation } from "@tanstack/react-query";
import { Navigate, useBlocker, useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmAccountMoveSheet } from "@/ui/components/accounts/ConfirmAccountMoveSheet";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { UnlockForm } from "@/ui/components/unlock-form/UnlockForm";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { MnemonicBackup } from "./mnemonic/MnemonicBackup";
import { MnemonicForm } from "./mnemonic/MnemonicForm";
import { type MnemonicFields, type MnemonicWord, mnemonicDefaultValues, mnemonicFromFields } from "./mnemonic/mnemonic";
import { type AddMnemonicWalletContext, useAddMnemonicWallet } from "./useAddMnemonicWallet";

type AdditionMode = "create" | "import";
const exitLocation = { to: "/onboarding", replace: true, ignoreBlocker: true } as const;

export function AddMnemonicWalletPage({ mode }: { mode: AdditionMode }) {
  const navigate = useNavigate();
  const { status } = useWallet();
  const { t } = useTranslation("onboarding");
  const onAdded = () => void navigate(exitLocation);

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
  return mode === "create" ? <NewMnemonicWallet onAdded={onAdded} /> : <ImportMnemonicWallet onAdded={onAdded} />;
}

function NewMnemonicWallet(context: AddMnemonicWalletContext) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("onboarding");
  const flow = useAddMnemonicWallet(context);
  const generation = useMutation({ mutationFn: () => wallet.keySources.generateMnemonic(), gcTime: 0 });
  const { mutate: generateMnemonic } = generation;
  const started = useRef(false);

  useBlocker({ shouldBlockFn: () => flow.isAdding, enableBeforeUnload: false });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    generateMnemonic();
  }, [generateMnemonic]);

  const mnemonic = generation.data?.mnemonic;
  const words: readonly MnemonicWord[] | undefined = mnemonic
    ?.split(" ")
    .map((word, index) => ({ position: index + 1, word }));

  async function add(backupStatus: BackupStatus, returnFocusElement?: HTMLElement | null) {
    if (!mnemonic) return false;
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
        pending={flow.isAdding}
        loading
        submitDisabled={!flow.canAdd}
        onComplete={() => void add("confirmed").catch(() => undefined)}
        onDefer={(trigger) => add("pending", trigger).catch(() => false)}
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
      <MnemonicForm form={form} onSubmit={importWallet} submitDisabled={!flow.canAdd} />
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
      accountGroup={move.accountGroup}
      accountId={move.accountId}
      walletName={move.walletName}
      description={t("firstAccountMoveDescription", {
        accountName: getAccountName(move.accountGroup, t),
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
