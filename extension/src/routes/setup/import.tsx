import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, Paragraph, XStack, YStack } from "tamagui";
import { Button } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireSetupUnlocked } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { ImportMnemonicScreen } from "@/ui/screens/onboarding/ImportMnemonicScreen";
import { ImportPrivateKeyScreen } from "@/ui/screens/onboarding/ImportPrivateKeyScreen";

type ImportMode = "mnemonic" | "privateKey";

export const Route = createFileRoute("/setup/import")({
  beforeLoad: requireSetupUnlocked,
  component: ImportSetupRoute,
  validateSearch: (search) => ({
    mode: (search.mode === "privateKey" ? "privateKey" : "mnemonic") as ImportMode,
  }),
});

function ImportSetupRoute() {
  const router = useRouter();
  const search = Route.useSearch();
  const { importMnemonic, importPrivateKey } = useUiSnapshot();

  const initialMode: ImportMode = search.mode === "privateKey" ? "privateKey" : "mnemonic";
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [mnemonicError, setMnemonicError] = useState<string | null>(null);
  const [privateError, setPrivateError] = useState<string | null>(null);
  const [mnemonicPending, setMnemonicPending] = useState(false);
  const [privatePending, setPrivatePending] = useState(false);

  // [import-route] Define tab metadata once
  const tabs = useMemo(
    () => [
      { value: "mnemonic" as const, label: "Seed phrase" },
      { value: "privateKey" as const, label: "Private key" },
    ],
    [],
  );

  const handleMnemonicImport = async (phrase: string, alias?: string) => {
    if (!phrase.trim()) {
      setMnemonicError("Enter a valid seed phrase");
      return;
    }
    setMnemonicPending(true);
    setMnemonicError(null);
    try {
      const words = phrase.trim().split(/\s+/).filter(Boolean);
      await importMnemonic({ words, alias });
      router.navigate({ to: ROUTES.SETUP_COMPLETE });
    } catch (err) {
      setMnemonicError(getErrorMessage(err));
    } finally {
      setMnemonicPending(false);
    }
  };

  const handlePrivateImport = async (privateKey: string, alias?: string) => {
    if (!privateKey.trim()) {
      setPrivateError("Enter a private key");
      return;
    }
    setPrivatePending(true);
    setPrivateError(null);
    try {
      await importPrivateKey({ privateKey: privateKey.trim(), alias });
      router.navigate({ to: ROUTES.SETUP_COMPLETE });
    } catch (err) {
      setPrivateError(getErrorMessage(err));
    } finally {
      setPrivatePending(false);
    }
  };

  return (
    <YStack flex={1} padding="$4" gap="$3">
      <Button onPress={() => router.navigate({ to: ROUTES.WELCOME })}>Back</Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Import wallet
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          Restore an existing account using a seed phrase or a raw private key.
        </Paragraph>

        <XStack gap="$2" marginTop="$3">
          {tabs.map((tab) => (
            <Button key={tab.value} flex={1} onPress={() => setMode(tab.value)}>
              {tab.label}
            </Button>
          ))}
        </XStack>
      </Card>

      {mode === "mnemonic" ? (
        <ImportMnemonicScreen error={mnemonicError} isLoading={mnemonicPending} onSubmit={handleMnemonicImport} />
      ) : (
        <ImportPrivateKeyScreen error={privateError} isLoading={privatePending} onSubmit={handlePrivateImport} />
      )}
    </YStack>
  );
}
