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
  validateSearch: (search): { mode?: ImportMode } => {
    if (search.mode === "mnemonic") return { mode: "mnemonic" };
    if (search.mode === "privateKey") return { mode: "privateKey" };
    return {};
  },
});

const requireOnboardingPassword = (password: string | null): string => {
  if (!password) {
    throw new Error("Onboarding password is required");
  }
  return password;
};

function ImportSetupRoute() {
  const router = useRouter();
  const search = Route.useSearch();
  const { snapshot } = useUiSnapshot();

  const password = useOnboardingStore((s) => s.password);
  const clear = useOnboardingStore((s) => s.clear);

  const forcedMode = search.mode;
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (password) return;
    if (!snapshot) return;
    if (snapshot.vault.initialized) return; // allow resuming setupIncomplete without re-entering password flow
    router.navigate({ to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "import" }, replace: true });
  }, [password, router, snapshot]);

  const handleImport = async (value: string, alias?: string) => {
    const vaultInitialized = snapshot?.vault.initialized ?? false;
    if (!vaultInitialized && !password) return;

    if (!value.trim()) {
      setError("Enter a recovery phrase or private key");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const getOnboardingPassword = () => requireOnboardingPassword(password);

      const importMnemonic = async (words: string[]) => {
        if (vaultInitialized) {
          return await uiClient.keyrings.importMnemonic({ words, alias });
        }
        return await uiClient.onboarding.importWalletFromMnemonic({
          password: getOnboardingPassword(),
          words,
          alias,
        });
      };

      const importPrivateKey = async (privateKey: string) => {
        if (vaultInitialized) {
          return await uiClient.keyrings.importPrivateKey({ privateKey, alias });
        }
        return await uiClient.onboarding.importWalletFromPrivateKey({
          password: getOnboardingPassword(),
          privateKey,
          alias,
        });
      };

      if (forcedMode === "mnemonic") {
        const words = splitMnemonicWords(value);
        await importMnemonic(words);
      } else if (forcedMode === "privateKey") {
        await importPrivateKey(sanitizePrivateKeyInput(value));
      } else {
        const words = splitMnemonicWords(value);
        const looksLikeMnemonic = words.length >= 11;

        const normalizedPrivateKey = sanitizePrivateKeyInput(value);
        const importAsMnemonic = async () => await importMnemonic(words);
        const importAsPrivateKey = async () => await importPrivateKey(normalizedPrivateKey);

        const primary = looksLikeMnemonic ? importAsMnemonic : importAsPrivateKey;
        const secondary = looksLikeMnemonic ? importAsPrivateKey : importAsMnemonic;

        try {
          await primary();
        } catch (primaryErr) {
          try {
            await secondary();
          } catch (secondaryErr) {
            const primaryMessage = getErrorMessage(primaryErr);
            const secondaryMessage = getErrorMessage(secondaryErr);
            setError(
              primaryMessage === secondaryMessage
                ? primaryMessage
                : `${primaryMessage}\n\nAlso tried another format: ${secondaryMessage}`,
            );
            return;
          }
        }
      }

      clear();
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return <ImportWalletScreen isLoading={isLoading} error={error} onSubmit={handleImport} />;
}
