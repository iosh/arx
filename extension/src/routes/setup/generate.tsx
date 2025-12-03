import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { mnemonicSession } from "@/ui/lib/mnemonicSession";
import { requireSetupUnlocked } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { GenerateMnemonicScreen } from "@/ui/screens/onboarding/GenerateMnemonicScreen";

export const Route = createFileRoute("/setup/generate")({
  beforeLoad: requireSetupUnlocked,
  component: GenerateMnemonicRoute,
});

function GenerateMnemonicRoute() {
  const router = useRouter();
  const { generateMnemonic, confirmNewMnemonic } = useUiSnapshot();
  const [words, setWords] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWords = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const response = await generateMnemonic(12);
      mnemonicSession.store(response.words);
      setWords(response.words);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  }, [generateMnemonic]);

  useEffect(() => {
    const cached = mnemonicSession.peek();
    if (cached && cached.length > 0) {
      setWords(cached);
      return;
    }
    void refreshWords();
    return () => {
      mnemonicSession.clear();
    };
  }, [refreshWords]);

  const handleVerify = () => {
    if (words.length === 0 || pending) return;
    mnemonicSession.store(words);
    router.navigate({ to: ROUTES.SETUP_VERIFY });
  };

  const handleSkip = async () => {
    if (words.length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      await confirmNewMnemonic({ words, skipBackup: true });
      mnemonicSession.clear();
      router.navigate({ to: ROUTES.SETUP_COMPLETE });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <GenerateMnemonicScreen
      words={words}
      isLoading={pending}
      error={error}
      onRefresh={refreshWords}
      onContinue={handleVerify}
      onSkip={handleSkip}
    />
  );
}
