import { Eip155InvalidPrivateKeyError } from "@arx/core/namespaces";
import { isWalletApiError } from "@arx/wallet-api/client";
import { createFileRoute, Navigate, useBlocker } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { CreatePasswordForm } from "@/ui/components/CreatePasswordForm";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { InputGroup } from "@/ui/components/ui/input-group";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/import-private-key")({
  component: ImportPrivateKey,
});

function ImportPrivateKey() {
  const [password, setPassword] = useState<string | null>(null);

  return password === null ? (
    <CreatePasswordForm totalSteps={2} onSubmit={setPassword} />
  ) : (
    <PrivateKeyForm password={password} onBack={() => setPassword(null)} />
  );
}

type PrivateKeyPreview = { privateKey: string; address: string | null };
const addressGroupOffsets = Array.from({ length: 10 }, (_, index) => 2 + index * 4);

function PrivateKeyForm({ password, onBack }: { password: string; onBack: () => void }) {
  const { client: wallet, status } = useWallet();
  const { t } = useTranslation(["onboarding", "common"]);
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
  const currentPreview = preview?.privateKey === privateKey ? preview : null;
  const address = currentPreview?.address;
  const invalid = address === null;

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  useEffect(() => {
    setPreview(null);
    if (!privateKey) return;

    let active = true;
    async function previewAddress() {
      try {
        const { displayAddress } = await wallet.keySources.getAddressFromPrivateKey({
          privateKey,
          chainRef: "eip155:1",
        });
        if (active) setPreview({ privateKey, address: displayAddress });
      } catch (error) {
        if (!active) return;
        if (isWalletApiError(error, Eip155InvalidPrivateKeyError)) {
          setPreview({ privateKey, address: null });
          return;
        }
        throw error;
      }
    }

    void previewAddress();
    return () => {
      active = false;
    };
  }, [privateKey, wallet]);

  async function importWallet() {
    if (!address) return;
    await wallet.createFromPrivateKey({ password, privateKey, namespace: "eip155" });
  }

  // Initialization is published before the response; exit only after this submission settles.
  // The previous render's submission blocker is still installed until its effect updates.
  if (status !== "uninitialized" && !pending) return <Navigate to="/onboarding" replace ignoreBlocker />;

  return (
    <OnboardingStepLayout progress={{ current: 2, total: 2 }} onBack={onBack} backDisabled={pending}>
      <OnboardingCard asChild title={t("importPrivateKey")} description={t("importPrivateKeyDescription")}>
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
              {invalid ? (
                <span className="text-destructive-foreground">{t("privateKeyIncorrect")}</span>
              ) : (
                t("privateKeyFormat")
              )}
            </FieldDescription>
          </Field>
          {address && (
            <section aria-label={t("privateKeyAddress")} className="flex flex-col gap-3 rounded-lg bg-background p-4">
              <h2 className="text-xs font-medium text-muted-foreground">{t("privateKeyAddress")}</h2>
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className="grid size-8 shrink-0 grid-cols-2 gap-0.5">
                  <span className="rounded-full bg-[#627eea]" />
                  <span className="rounded-full bg-[#0052ff]" />
                  <span className="rounded-full bg-[#12aaff]" />
                  <span className="rounded-full bg-[#8247e5]" />
                </span>
                <span className="text-sm font-semibold">Ethereum · Base · Arbitrum · Polygon</span>
              </div>
              <p>
                <span className="sr-only">{address}</span>
                <span
                  aria-hidden="true"
                  className="grid w-fit grid-cols-5 gap-x-1.5 gap-y-px font-mono text-sm leading-normal text-muted-foreground"
                >
                  {addressGroupOffsets.map((offset) => (
                    <span key={offset} className={offset === 2 || offset === 38 ? "font-semibold text-foreground" : ""}>
                      {address.slice(offset === 2 ? 0 : offset, offset + 4)}
                    </span>
                  ))}
                </span>
              </p>
            </section>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full aria-busy:opacity-70"
            disabled={!address || pending}
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
