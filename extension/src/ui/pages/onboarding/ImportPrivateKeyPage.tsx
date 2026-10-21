import { KeyringInvalidPrivateKeyError } from "@arx/core/keyring";
import type { ChainRef } from "@arx/core/networks";
import { isWalletApiError, type WalletClient } from "@arx/wallet-api/client";
import { Navigate, useBlocker } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { InputGroup } from "@/ui/components/ui/input-group";
import { Spinner } from "@/ui/components/ui/spinner";
import { getNamespaceUi } from "@/ui/namespaces";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkSelection } from "@/ui/wallet/networks/useNetworkSelection";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { CreatePasswordForm } from "./CreatePasswordForm";

export function ImportPrivateKeyPage() {
  const [password, setPassword] = useState<string | null>(null);

  return password === null ? (
    <CreatePasswordForm totalSteps={2} onSubmit={setPassword} />
  ) : (
    <PrivateKeyForm password={password} onBack={() => setPassword(null)} />
  );
}

type PrivateKeyAccount = Awaited<ReturnType<WalletClient["accounts"]["fromPrivateKey"]>>;
type PrivateKeyPreview = { privateKey: string; chainRef: ChainRef; account: PrivateKeyAccount | null };

function PrivateKeyForm({ password, onBack }: { password: string; onBack: () => void }) {
  const { client: wallet, status } = useWallet();
  const { t } = useTranslation(["onboarding", "common"]);
  const networkSelection = useNetworkSelection();
  const chainRef = networkSelection.data?.selectedChainRef;
  const namespaceUi = networkSelection.data ? getNamespaceUi(networkSelection.data.selectedNamespace) : null;
  const showError = useWalletError();
  const reportPreviewError = useEffectEvent(showError);
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<PrivateKeyPreview | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting: pending },
  } = useForm({ defaultValues: { privateKey: "" } });
  const privateKey = useWatch({ control, name: "privateKey" }).trim();
  const currentPreview = preview?.privateKey === privateKey && preview.chainRef === chainRef ? preview : null;
  const account = currentPreview?.account;
  const invalid = account === null;

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  useEffect(() => {
    if (networkSelection.error) reportPreviewError(networkSelection.error);
  }, [networkSelection.error]);

  useEffect(() => {
    setPreview(null);
    if (!privateKey || !chainRef) return;

    let active = true;
    const previewAddress = async () => {
      try {
        const account = await wallet.accounts.fromPrivateKey({ privateKey, chainRef });
        if (active) setPreview({ privateKey, chainRef, account });
      } catch (error) {
        if (!active) return;
        if (isWalletApiError(error, KeyringInvalidPrivateKeyError)) {
          setPreview({ privateKey, chainRef, account: null });
          return;
        }
        reportPreviewError(error);
      }
    };

    void previewAddress();
    return () => {
      active = false;
    };
  }, [privateKey, chainRef, wallet]);

  async function importWallet() {
    if (!account) return;
    try {
      await wallet.createFromPrivateKey({ password, privateKey, namespace: account.namespace });
    } catch (error) {
      showError(error);
    }
  }

  // Initialization is published before the response; exit only after this submission settles.
  // The previous render's submission blocker is still installed until its effect updates.
  if (status !== "uninitialized" && !pending) return <Navigate to="/onboarding" replace ignoreBlocker />;

  return (
    <OnboardingStepLayout progress={{ current: 2, total: 2 }} onBack={onBack} backDisabled={pending}>
      <OnboardingCard
        asChild
        title={t("importPrivateKey")}
        description={namespaceUi ? t(namespaceUi.privateKeyDescriptionKey) : undefined}
      >
        <form onSubmit={handleSubmit(importWallet)} autoComplete="off" aria-busy={pending}>
          <Field>
            <FieldLabel htmlFor={id}>{t("privateKey")}</FieldLabel>
            <InputGroup className="h-24 items-start gap-2 p-2.5 pl-3">
              <textarea
                {...register("privateKey")}
                id={id}
                data-slot="input-group-control"
                rows={3}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={pending}
                aria-invalid={invalid}
                aria-describedby={`${id}-description`}
                className={`h-full min-w-0 flex-1 resize-none bg-transparent font-mono text-sm leading-relaxed outline-none disabled:cursor-not-allowed ${visible ? "" : "[-webkit-text-security:disc]"}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground disabled:opacity-100"
                aria-label={t(visible ? "common:hidePassword" : "common:showPassword", { field: t("privateKey") })}
                onClick={() => setVisible(!visible)}
                disabled={pending}
              >
                {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </InputGroup>
            <FieldDescription id={`${id}-description`} aria-live="polite">
              {!namespaceUi ? (
                networkSelection.isError ? (
                  t("common:networkUnavailable")
                ) : (
                  <Spinner aria-label={t("common:loadingNetwork")} />
                )
              ) : invalid ? (
                <span className="text-destructive-foreground">{t("privateKeyIncorrect")}</span>
              ) : (
                t(namespaceUi.privateKeyFormatKey)
              )}
            </FieldDescription>
          </Field>
          {account && (
            <section aria-label={t("privateKeyAddress")} className="flex flex-col gap-3 rounded-lg bg-background p-4">
              <h2 className="text-xs font-medium text-muted-foreground">{t("privateKeyAddress")}</h2>
              {account.addresses.map((address) => {
                const { Icon, nameKey, AddressPreview } = getNamespaceUi(address.namespace);
                return (
                  <div key={address.address} className="flex flex-col gap-3">
                    <div className="flex items-center gap-2.5">
                      <Icon />
                      <span className="text-sm font-semibold">{t(nameKey, { ns: "common" })}</span>
                    </div>
                    <AddressPreview address={address.address} />
                  </div>
                );
              })}
            </section>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full aria-busy:opacity-70"
            disabled={!account || pending}
            aria-busy={pending}
          >
            {pending && <Spinner aria-label={t("importPrivateKeyAction")} />}
            {t("importPrivateKeyAction")}
          </Button>
        </form>
      </OnboardingCard>
    </OnboardingStepLayout>
  );
}
