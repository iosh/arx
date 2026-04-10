import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { sanitizePrivateKeyInput } from "@/ui/lib/privateKeyInput";
import { requireSetupIncomplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { uiClient } from "@/ui/lib/uiBridgeClient";
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
  const { snapshot } = useUiSnapshot();

  const password = useOnboardingStore((s) => s.password);
  const clear = useOnboardingStore((s) => s.clear);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (password) return;
    if (!snapshot) return;
    if (snapshot.vault.initialized) return; // allow resuming setupIncomplete without re-entering password flow
    router.navigate({ to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "import" }, replace: true });
  }, [password, router, snapshot]);

  const handleImport = async (params: { value: string; mode: ImportMode; alias?: string }) => {
    const vaultInitialized = snapshot?.vault.initialized ?? false;
    if (!vaultInitialized && !password) return;

    if (!params.value.trim()) {
      setError("Enter a recovery phrase or private key");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const getOnboardingPassword = () => requireOnboardingPassword(password);

      const importMnemonic = async (words: string[]) => {
        if (vaultInitialized) {
          return await uiClient.keyrings.importMnemonic({ words, alias: params.alias });
        }
        return await uiClient.onboarding.importWalletFromMnemonic({
          password: getOnboardingPassword(),
          words,
          alias: params.alias,
        });
      };

      const importPrivateKey = async (privateKey: string) => {
        if (vaultInitialized) {
          return await uiClient.keyrings.importPrivateKey({ privateKey, alias: params.alias });
        }
        return await uiClient.onboarding.importWalletFromPrivateKey({
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
