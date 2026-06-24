import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRefreshUiSetupStatus, useUiSetupStatus } from "@/ui/hooks/useUiSetupStatus";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { buildCreateEntryRedirect } from "@/ui/lib/onboardingFlow";
import { ROUTES } from "@/ui/lib/routes";
import { app } from "@/ui/lib/uiBridgeClient";
import { isWalletInitialized, isWalletReady } from "@/ui/lib/walletAvailability";
import { GenerateMnemonicScreen } from "@/ui/screens/onboarding/GenerateMnemonicScreen";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";

export const Route = createFileRoute("/onboarding/create")({
  component: GenerateMnemonicRoute,
});

const requireOnboardingPassword = (password: string | null): string => {
  if (!password) {
    throw new Error("Onboarding password is required");
  }
  return password;
};

function GenerateMnemonicRoute() {
  const router = useRouter();
  const { data: setupStatus } = useUiSetupStatus();
  const refreshSetupStatus = useRefreshUiSetupStatus();
  const password = useOnboardingStore((s) => s.password);
  const mnemonicWords = useOnboardingStore((s) => s.mnemonicWords);
  const mnemonicKeyringId = useOnboardingStore((s) => s.mnemonicKeyringId);
  const setMnemonicWords = useOnboardingStore((s) => s.setMnemonicWords);
  const setMnemonicKeyringId = useOnboardingStore((s) => s.setMnemonicKeyringId);
  const clearPassword = useOnboardingStore((s) => s.clearPassword);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prevent duplicate auto-generation when React replays effects in development.
  const autoGenerateRequestedRef = useRef(false);
  const walletAvailability = setupStatus?.onboarding.availability;
  const hasAccounts = isWalletReady(walletAvailability);
  const words = mnemonicWords ?? [];

  useEffect(() => {
    const redirect = buildCreateEntryRedirect({
      setupStatus,
      password,
      mnemonicWords,
      mnemonicKeyringId,
    });
    if (!redirect) return;
    router.navigate(redirect);
  }, [mnemonicKeyringId, mnemonicWords, password, router, setupStatus]);

  const generateWords = useCallback(async () => {
    if (hasAccounts) {
      setError("Wallet is already created. You can verify the phrase, but you cannot regenerate it.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const response = await app.wallet.setup.generateMnemonic({ wordCount: 12 });
      setMnemonicWords(response.words);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  }, [hasAccounts, setMnemonicWords]);

  useEffect(() => {
    if (words.length > 0 || hasAccounts || autoGenerateRequestedRef.current) return;
    autoGenerateRequestedRef.current = true;
    void generateWords();
  }, [generateWords, hasAccounts, words.length]);

  const handleContinue = async () => {
    if (hasAccounts) {
      router.navigate({ to: ROUTES.ONBOARDING_BACKUP, replace: true });
      return;
    }

    const vaultInitialized = isWalletInitialized(walletAvailability);
    if (!vaultInitialized && !password) return;
    if (words.length === 0 || isGenerating || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    let navigatedToBackup = false;
    try {
      const res = vaultInitialized
        ? await app.wallet.keyrings.confirmNewMnemonic({ words })
        : await app.wallet.setup.createWalletFromMnemonic({
            password: requireOnboardingPassword(password),
            words,
          });

      // Keep words for backup confirmation; clear password once the vault setup is complete.
      clearPassword();
      setMnemonicWords(words);
      setMnemonicKeyringId(res.keyringId);

      await refreshSetupStatus();

      await router.navigate({ to: ROUTES.ONBOARDING_BACKUP, replace: true });
      navigatedToBackup = true;
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      if (!navigatedToBackup) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <GenerateMnemonicScreen
      words={words}
      isGenerating={isGenerating}
      isSubmitting={isSubmitting}
      error={error}
      onRefresh={generateWords}
      onContinue={handleContinue}
    />
  );
}
