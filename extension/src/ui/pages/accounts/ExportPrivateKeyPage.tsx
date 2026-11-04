import { type AccountGroup, type AccountGroupId, type AccountId, AccountNotFoundError } from "@arx/core/accounts";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { AccountAddressCard } from "./AccountAddressCard";
import { useCopyToClipboard } from "./useCopyToClipboard";

export function ExportPrivateKeyPage({
  accountGroupId,
  accountId,
}: {
  accountGroupId: AccountGroupId;
  accountId: AccountId;
}) {
  const { t } = useTranslation("wallet");
  const { data: accounts, isPending } = useVisibleAccounts();
  const account = accounts?.find((candidate) => candidate.accountGroupId === accountGroupId);

  if (account?.members.some((member) => member.accountId === accountId))
    return <ExportPrivateKeyFlow account={account} accountId={accountId} />;

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("exportPrivateKey")} · ARX`}</title>
      <PageHeader title={t("exportPrivateKey")} backTo="/wallet/accounts" backLabel={t("backToAccounts")} />
      <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
        {isPending ? <Spinner aria-label={t("loadingAccount")} /> : t("accountUnavailable")}
      </div>
    </main>
  );
}

function ExportPrivateKeyFlow({ account, accountId }: { account: AccountGroup; accountId: AccountId }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation(["wallet", "onboarding"]);
  const navigate = useNavigate();
  const reportError = useWalletError();
  const id = useId();
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isValid },
  } = useForm({ defaultValues: { password: "" }, mode: "onChange" });
  const incorrect = errors.password?.type === "incorrectPassword";
  const reveal = useWalletMutation({
    mutationFn: ({ password }: { password: string }) => wallet.accounts.exportPrivateKey({ accountId, password }),
    gcTime: 0,
  });
  const pending = reveal.isPending;

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  function submit({ password }: { password: string }) {
    reveal.mutate(
      { password },
      {
        onSuccess: (result) => {
          if (result === null) {
            setError("password", { type: "incorrectPassword" });
            return;
          }
          reset();
          setPrivateKey(result.privateKey);
        },
        onError: (error) => {
          // The shared account query removes this flow when the target disappears.
          if (isWalletApiError(error, AccountNotFoundError)) return;
          reportError(error);
        },
        onSettled: () => reveal.reset(),
      },
    );
  }

  function complete() {
    setPrivateKey(null);
    void navigate({
      to: "/wallet/accounts/$accountGroupId",
      params: { accountGroupId: account.accountGroupId },
      replace: true,
    });
  }

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("exportPrivateKey")} · ARX`}</title>
      <PageHeader
        title={t("exportPrivateKey")}
        subtitle={getAccountName(account, t)}
        backTo="/wallet/accounts/$accountGroupId"
        backLabel={t("backToAccountDetails")}
        backDisabled={pending}
      />
      <form
        onSubmit={privateKey === null ? handleSubmit(submit) : undefined}
        aria-busy={pending}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
          <div className="flex items-start gap-2 px-1.5 text-xs leading-normal font-medium text-warning-foreground">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <p>{t("privateKeyWarning")}</p>
          </div>
          <AccountAddressCard account={account} memberId={accountId} copyable={false} />
          {privateKey === null ? (
            <Field className="gap-2">
              <FieldLabel htmlFor={id} className="px-1 text-xs text-muted-foreground">
                {t("unlockPassword")}
              </FieldLabel>
              <PasswordInput
                {...register("password", { required: true })}
                id={id}
                fieldLabel={t("unlockPassword")}
                placeholder={t("onboarding:unlockPasswordPlaceholder")}
                autoComplete="current-password"
                className="pl-3.5 font-semibold"
                groupClassName="bg-card [&_[data-slot=input-group-addon]]:pr-2 [&_button]:size-7 [&_button]:rounded-md"
                disabled={pending}
                aria-invalid={incorrect}
                aria-describedby={incorrect ? `${id}-description` : undefined}
              />
              {incorrect && (
                <FieldDescription id={`${id}-description`} aria-live="polite" className="px-1">
                  <span className="text-destructive-foreground">{t("incorrectPassword")}</span>
                </FieldDescription>
              )}
            </Field>
          ) : (
            <PrivateKeyCard privateKey={privateKey} />
          )}
        </div>
        <footer className="shrink-0 px-3.5 pt-2 pb-3.5">
          {privateKey === null ? (
            <Button
              type="submit"
              className="w-full aria-busy:opacity-70"
              disabled={!isValid || pending}
              aria-busy={pending}
            >
              {pending && <Spinner aria-label={t("showPrivateKey")} />}
              {t("showPrivateKey")}
            </Button>
          ) : (
            <Button type="button" className="w-full" onClick={complete}>
              {t("onboarding:complete")}
            </Button>
          )}
        </footer>
      </form>
    </main>
  );
}

function PrivateKeyCard({ privateKey }: { privateKey: string }) {
  const { t } = useTranslation("wallet");
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();
  return (
    <section aria-label={t("privateKey")} className="shrink-0 rounded-2xl bg-card p-4 text-card-foreground">
      <p dir="ltr" className="font-mono text-sm leading-relaxed font-medium break-all">
        {privateKey}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3 rounded-[10px] text-xs has-[>svg]:px-3"
        disabled={isCopying}
        aria-busy={isCopying}
        onClick={() => copy(privateKey)}
      >
        {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
        {t(copied ? "privateKeyCopied" : "copyPrivateKey")}
      </Button>
      <p role="status" className={copyFailed ? "mt-2 text-xs text-destructive-foreground" : "sr-only"}>
        {copied ? t("privateKeyCopied") : copyFailed ? t("copyPrivateKeyFailed") : ""}
      </p>
    </section>
  );
}
