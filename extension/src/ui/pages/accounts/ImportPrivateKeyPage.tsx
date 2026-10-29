import { useBlocker, useNavigate } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PrivateKeyAddressPreview, PrivateKeyInput } from "@/ui/components/accounts/PrivateKeyImport";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { getNamespaceUi } from "@/ui/namespaces";
import { useAccountFromPrivateKey } from "@/ui/wallet/accounts/useAccountFromPrivateKey";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkSelection } from "@/ui/wallet/networks/useNetworkSelection";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export function ImportPrivateKeyPage() {
  const { client: wallet } = useWallet();
  const { t } = useTranslation(["wallet", "onboarding", "common"]);
  const navigate = useNavigate();
  const id = useId();
  const { data: networkSelection, isPending: networkPending } = useNetworkSelection();
  const chainRef = networkSelection?.selectedChainRef;
  const namespaceUi = networkSelection ? getNamespaceUi(networkSelection.selectedNamespace) : null;
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting: pending },
  } = useForm({ defaultValues: { privateKey: "" } });
  const privateKey = useWatch({ control, name: "privateKey" }).trim();
  const { account, invalid } = useAccountFromPrivateKey({ privateKey, chainRef });
  const {
    mutateAsync: importPrivateKey,
    data: importResult,
    reset: resetImport,
  } = useWalletMutation({ mutationFn: wallet.keySources.importPrivateKey, gcTime: 0 });
  const duplicateAccount = importResult?.status === "duplicate" ? importResult.account : undefined;
  let fieldError: string | undefined;
  if (duplicateAccount)
    fieldError = t("privateKeyAlreadyImported", { accountName: getAccountName(duplicateAccount, t) });
  else if (invalid) fieldError = t("onboarding:privateKeyIncorrect");

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  async function importAccount(preview: NonNullable<typeof account>) {
    const result = await importPrivateKey(
      { privateKey, namespace: preview.namespace },
      {
        onSuccess: (result) => {
          if (result.status === "added") void navigate({ to: "/wallet/accounts", replace: true, ignoreBlocker: true });
        },
      },
    ).catch(() => undefined);
    if (result?.status !== "duplicate") resetImport();
  }

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("onboarding:importPrivateKey")} · ARX`}</title>
      <PageHeader
        title={t("onboarding:importPrivateKey")}
        backTo="/wallet/accounts/add"
        backLabel={t("backToAdd")}
        backDisabled={pending}
      />
      <form
        onSubmit={account && !duplicateAccount ? handleSubmit(() => importAccount(account)) : undefined}
        autoComplete="off"
        aria-busy={pending}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
          <Field className="gap-2">
            <FieldLabel htmlFor={id} className="px-1 text-xs text-muted-foreground">
              {t("privateKey")}
            </FieldLabel>
            <PrivateKeyInput
              {...register("privateKey", { onChange: resetImport })}
              id={id}
              surface="popup"
              disabled={pending}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={`${id}-description`}
            />
            <FieldDescription id={`${id}-description`} aria-live="polite" className="px-1">
              {fieldError ? (
                <span className="flex gap-1.5 text-destructive-foreground">
                  <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  <span className="wrap-anywhere">{fieldError}</span>
                </span>
              ) : namespaceUi ? (
                t(namespaceUi.privateKeyImport.formatHintKey)
              ) : (
                networkPending && <Spinner aria-label={t("common:loadingNetwork")} />
              )}
            </FieldDescription>
          </Field>
          {account && (
            <PrivateKeyAddressPreview
              addresses={account.addresses}
              className="rounded-2xl bg-card text-card-foreground"
            />
          )}
        </div>
        <footer className="shrink-0 px-3.5 pt-2 pb-3.5">
          <Button
            type="submit"
            className="w-full aria-busy:opacity-70"
            disabled={!account || Boolean(duplicateAccount) || pending}
            aria-busy={pending}
          >
            {pending && <Spinner aria-label={t("onboarding:importPrivateKeyAction")} />}
            {t("onboarding:importPrivateKeyAction")}
          </Button>
        </footer>
      </form>
    </main>
  );
}
