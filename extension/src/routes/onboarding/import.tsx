import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
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

const sanitizePrivateKeyInput = (value: string) => value.trim().replace(/[\s,]+/g, "");

export const Route = createFileRoute("/onboarding/import")({
  beforeLoad: requireSetupIncomplete,
  component: ImportSetupRoute,
  validateSearch: (search): { mode?: ImportMode } => {
    if (search.mode === "mnemonic") return { mode: "mnemonic" };
    if (search.mode === "privateKey") return { mode: "privateKey" };
    return {};
  },
});

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
    const passwordParam = password ?? undefined;

    if (!value.trim()) {
      setError("Enter a recovery phrase or private key");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (forcedMode === "mnemonic") {
        const words = splitMnemonicWords(value);
        await uiClient.onboarding.importWalletFromMnemonic({ password: passwordParam, words, alias });
      } else if (forcedMode === "privateKey") {
        await uiClient.onboarding.importWalletFromPrivateKey({
          password: passwordParam,
          privateKey: sanitizePrivateKeyInput(value),
          alias,
        });
      } else {
        const words = splitMnemonicWords(value);
        const looksLikeMnemonic = words.length >= 11;

        const importAsMnemonic = async () =>
          uiClient.onboarding.importWalletFromMnemonic({ password: passwordParam, words, alias });
        const importAsPrivateKey = async () =>
          uiClient.onboarding.importWalletFromPrivateKey({
            password: passwordParam,
            privateKey: sanitizePrivateKeyInput(value),
            alias,
          });

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
