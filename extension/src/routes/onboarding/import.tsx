import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRefreshUiSetupStatus, useUiSetupStatus } from "@/ui/hooks/useUiSetupStatus";
import { app } from "@/ui/lib/app";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { sanitizePrivateKeyInput } from "@/ui/lib/privateKeyInput";
import { requireSetupIncomplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { ImportWalletScreen } from "@/ui/screens/onboarding/ImportWalletScreen";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";

type ImportMode = "mnemonic" | "privateKey";

const splitMnemonicWords = (value: string) =>
  value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);

export const Route = createFileRoute("/onboarding/import")({
  beforeLoad: requireSetupIncomplete,
  component: ImportSetupRoute,
});

const requireOnboardingPassword = (password: string | null): string => {
  if (!password) {
    throw new Error("Onboarding password is required");
  }
  return password;
};

function ImportSetupRoute() {
  const router = useRouter();
  const { data: setupStatus } = useUiSetupStatus();
  const refreshSetupStatus = useRefreshUiSetupStatus();

  const password = useOnboardingStore((s) => s.password);
  const clear = useOnboardingStore((s) => s.clear);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (password) return;
    if (!setupStatus) return;
    router.navigate({ to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "import" }, replace: true });
  }, [password, router, setupStatus]);

  const handleImport = async (params: { value: string; mode: ImportMode; alias?: string }) => {
    if (!password) return;

    if (!params.value.trim()) {
      setError("Enter a recovery phrase or private key");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const getOnboardingPassword = () => requireOnboardingPassword(password);

      const importMnemonic = async (words: string[]) => {
        return await app.wallet.setup.restoreWalletFromMnemonic({
          password: getOnboardingPassword(),
          words,
          alias: params.alias,
        });
      };

      const importPrivateKey = async (privateKey: string) => {
        return await app.wallet.setup.restoreWalletFromPrivateKey({
          password: getOnboardingPassword(),
          privateKey,
          alias: params.alias,
        });
      };

      if (params.mode === "mnemonic") {
        const words = splitMnemonicWords(params.value);
        await importMnemonic(words);
      } else {
        await importPrivateKey(sanitizePrivateKeyInput(params.value));
      }

      clear();
      await refreshSetupStatus();
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ImportWalletScreen
      isSubmitting={isSubmitting}
      error={error}
      onChange={() => {
        if (error) setError(null);
      }}
      onSubmit={handleImport}
    />
  );
}
