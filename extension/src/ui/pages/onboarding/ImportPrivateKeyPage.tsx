import type { WalletClient } from "@arx/wallet-api/client";
import { Navigate, useBlocker } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { InputGroup } from "@/ui/components/ui/input-group";
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
  const [visible, setVisible] = useState(false);
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
                networkPending && <Spinner aria-label={t("common:loadingNetwork")} />
              ) : invalid ? (
                <span className="text-destructive-foreground">{t("privateKeyIncorrect")}</span>
              ) : (
                t(namespaceUi.privateKeyImport.formatHintKey)
              )}
            </FieldDescription>
          </Field>
          {account && (
            <section aria-label={t("privateKeyAddress")} className="flex flex-col gap-3 rounded-lg bg-background p-4">
              <h2 className="text-xs font-medium text-muted-foreground">{t("privateKeyAddress")}</h2>
              {account.addresses.map((address) => {
                const { Icon, labelKey, privateKeyImport } = getNamespaceUi(address.namespace);
                const { GroupedAddress } = privateKeyImport;
                return (
                  <div key={address.address} className="flex flex-col gap-3">
                    <div className="flex items-center gap-2.5">
                      <Icon />
                      <span className="text-sm font-semibold">{t(labelKey)}</span>
                    </div>
                    <GroupedAddress address={address.address} />
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
