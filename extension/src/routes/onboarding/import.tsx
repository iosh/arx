import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Screen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireSetupIncomplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { ImportWalletScreen } from "@/ui/screens/onboarding/ImportWalletScreen";

type ImportMode = "mnemonic" | "privateKey";

const normalizeWords = (value: string) =>
  value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);

const normalizePrivateKey = (value: string) => value.trim().replace(/[\s,]+/g, "");

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
  const { importMnemonic, importPrivateKey } = useUiSnapshot();

  const forcedMode = search.mode;
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleImport = async (value: string, alias?: string) => {
    if (!value.trim()) {
      setError("Enter a recovery phrase or private key");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (forcedMode === "mnemonic") {
        const words = normalizeWords(value);
        await importMnemonic({ words, alias });
      } else if (forcedMode === "privateKey") {
        await importPrivateKey({ privateKey: normalizePrivateKey(value), alias });
      } else {
        const words = normalizeWords(value);
        const looksLikeMnemonic = words.length >= 11;
        const primary = looksLikeMnemonic
          ? async () => importMnemonic({ words, alias })
          : async () => importPrivateKey({ privateKey: normalizePrivateKey(value), alias });
        const secondary = looksLikeMnemonic
          ? async () => importPrivateKey({ privateKey: normalizePrivateKey(value), alias })
          : async () => importMnemonic({ words, alias });

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
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Screen>
      <ImportWalletScreen
        isLoading={isLoading}
        error={error}
        onSubmit={handleImport}
      />
    </Screen>
  );
}
