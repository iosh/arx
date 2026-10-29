import type { WalletClient } from "@arx/wallet-api/client";
import { Navigate, useBlocker } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PrivateKeyAddressPreview, PrivateKeyInput } from "@/ui/components/accounts/PrivateKeyImport";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { getNamespaceUi } from "@/ui/namespaces";
import { useAccountFromPrivateKey } from "@/ui/wallet/accounts/useAccountFromPrivateKey";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkSelection } from "@/ui/wallet/networks/useNetworkSelection";
import { useCreatePrivateKeyWallet } from "@/ui/wallet/useWalletMutations";
import { CreatePasswordForm } from "./CreatePasswordForm";

export function ImportPrivateKeyPage() {
  const [password, setPassword] = useState<string | null>(null);

  return password === null ? (
    <CreatePasswordForm totalSteps={2} onSubmit={setPassword} />
  ) : (
    <PrivateKeyForm password={password} onBack={() => setPassword(null)} />
  );
}

type PrivateKeyAccount = NonNullable<Awaited<ReturnType<WalletClient["accounts"]["fromPrivateKey"]>>>;

function PrivateKeyForm({ password, onBack }: { password: string; onBack: () => void }) {
  const { status } = useWallet();
  const { t } = useTranslation(["onboarding", "common"]);
  const { data: networkSelection, isPending: networkPending } = useNetworkSelection();
  const chainRef = networkSelection?.selectedChainRef;
  const namespaceUi = networkSelection ? getNamespaceUi(networkSelection.selectedNamespace) : null;
  const id = useId();
  const { mutateAsync: createWallet, reset: resetImport } = useCreatePrivateKeyWallet();
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting: pending },
  } = useForm({ defaultValues: { privateKey: "" } });
  const privateKey = useWatch({ control, name: "privateKey" }).trim();
  const { account, invalid } = useAccountFromPrivateKey({ privateKey, chainRef });

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  async function importWallet(account: PrivateKeyAccount) {
    await createWallet({ password, privateKey, namespace: account.namespace }).catch(() => undefined);
    resetImport();
  }

  // Initialization is published before the response; exit only after this submission settles.
  // The previous render's submission blocker is still installed until its effect updates.
  if (status !== "uninitialized" && !pending) return <Navigate to="/onboarding" replace ignoreBlocker />;

  return (
    <OnboardingStepLayout progress={{ current: 2, total: 2 }} onBack={onBack} backDisabled={pending}>
      <OnboardingCard
        asChild
        title={t("importPrivateKey")}
        description={namespaceUi ? t(namespaceUi.privateKeyImport.descriptionKey) : undefined}
      >
        <form
          onSubmit={account ? handleSubmit(() => importWallet(account)) : undefined}
          autoComplete="off"
          aria-busy={pending}
        >
          <Field>
            <FieldLabel htmlFor={id}>{t("privateKey")}</FieldLabel>
            <PrivateKeyInput
              {...register("privateKey")}
              id={id}
              disabled={pending}
              aria-invalid={invalid}
              aria-describedby={`${id}-description`}
            />
            <FieldDescription id={`${id}-description`} aria-live="polite">
              {!namespaceUi ? (
                networkPending && <Spinner aria-label={t("common:loadingNetwork")} />
              ) : invalid ? (
                <span className="text-destructive-foreground">{t("privateKeyIncorrect")}</span>
              ) : (
                t(namespaceUi.privateKeyImport.formatHintKey)
              )}
            </FieldDescription>
          </Field>
          {account && <PrivateKeyAddressPreview addresses={account.addresses} />}
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
