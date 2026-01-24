import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireSetupIncompleteOrMnemonicReview } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { GenerateMnemonicScreen } from "@/ui/screens/onboarding/GenerateMnemonicScreen";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";

export const Route = createFileRoute("/onboarding/generate")({
  beforeLoad: requireSetupIncompleteOrMnemonicReview,
  component: GenerateMnemonicRoute,
});

function GenerateMnemonicRoute() {
  const router = useRouter();
  const { snapshot } = useUiSnapshot();
  const password = useOnboardingStore((s) => s.password);
  const mnemonicWords = useOnboardingStore((s) => s.mnemonicWords);
  const mnemonicKeyringId = useOnboardingStore((s) => s.mnemonicKeyringId);
  const setMnemonicWords = useOnboardingStore((s) => s.setMnemonicWords);
  const setMnemonicKeyringId = useOnboardingStore((s) => s.setMnemonicKeyringId);
  const clearPassword = useOnboardingStore((s) => s.clearPassword);
  const clearMnemonicWords = useOnboardingStore((s) => s.clearMnemonicWords);

  const [words, setWords] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (password) return;
    if (!snapshot) return;
    if (snapshot.vault.initialized) return; // allow resuming setupIncomplete without re-entering password flow
    router.navigate({ to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "create" }, replace: true });
  }, [password, router, snapshot]);

  const refreshWords = useCallback(async () => {
    if (snapshot?.accounts.totalCount) {
      setError("Wallet is already created. You can verify the phrase, but you cannot regenerate it.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await uiClient.onboarding.generateMnemonic({ wordCount: 12 });
      setMnemonicWords(response.words);
      setWords(response.words);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  }, [setMnemonicWords, snapshot?.accounts.totalCount]);

  useEffect(() => {
    if (mnemonicWords && mnemonicWords.length > 0) {
      setWords(mnemonicWords);
      return;
    }
    void refreshWords();
  }, [mnemonicWords, refreshWords]);

  const handleContinue = async () => {
    if (snapshot?.accounts.totalCount) {
      const keyringId = mnemonicKeyringId ?? snapshot.warnings.hdKeyringsNeedingBackup[0]?.keyringId;
      if (!keyringId) {
        router.navigate({ to: ROUTES.ONBOARDING_COMPLETE, replace: true });
        return;
      }
      router.navigate({ to: ROUTES.ONBOARDING_VERIFY, search: { keyringId }, replace: true });
      return;
    }

    const vaultInitialized = snapshot?.vault.initialized ?? false;
    if ((!vaultInitialized && !password) || words.length === 0 || pending) return;

    setPending(true);
    setError(null);
    try {
      const res = await uiClient.onboarding.createWalletFromMnemonic({
        password: password ?? undefined,
        words,
        skipBackup: true,
      });

      // Keep words for Verify; clear password as soon as we no longer need it.
      clearPassword();
      setMnemonicWords(words);
      setMnemonicKeyringId(res.keyringId);

      router.navigate({ to: ROUTES.ONBOARDING_VERIFY, search: { keyringId: res.keyringId }, replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const handleSkip = async () => {
    if (snapshot?.accounts.totalCount) {
      clearPassword();
      clearMnemonicWords();
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE, replace: true });
      return;
    }

    const vaultInitialized = snapshot?.vault.initialized ?? false;
    if ((!vaultInitialized && !password) || words.length === 0 || pending) return;

    setPending(true);
    setError(null);
    try {
      await uiClient.onboarding.createWalletFromMnemonic({
        password: password ?? undefined,
        words,
        skipBackup: true,
      });

      clearPassword();
      clearMnemonicWords();
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE, replace: true });
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
      onContinue={handleContinue}
      onSkip={handleSkip}
    />
  );
}
