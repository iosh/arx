import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { VerifyMnemonicScreen } from "@/ui/screens/onboarding/VerifyMnemonicScreen";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";

const buildQuizIndexes = (count: number): number[] => {
  if (count <= 0) return [];
  const indexes = new Set<number>();
  indexes.add(0);
  indexes.add(Math.min(count - 1, 6));
  while (indexes.size < Math.min(3, count)) {
    indexes.add(Math.floor(Math.random() * count));
  }
  return Array.from(indexes.values()).sort((a, b) => a - b);
};

export const Route = createFileRoute("/onboarding/verify")({
  beforeLoad: requireVaultInitialized,
  validateSearch: (search): { keyringId?: string } => ({
    keyringId: typeof search?.keyringId === "string" ? search.keyringId : undefined,
  }),
  component: VerifyMnemonicRoute,
});
function VerifyMnemonicRoute() {
  const router = useRouter();
  const search = Route.useSearch();
  const { markBackedUp } = useUiSnapshot();
  const mnemonicWords = useOnboardingStore((s) => s.mnemonicWords);
  const mnemonicKeyringId = useOnboardingStore((s) => s.mnemonicKeyringId);
  const clearMnemonicWords = useOnboardingStore((s) => s.clearMnemonicWords);

  const [words, setWords] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mnemonicWords || mnemonicWords.length === 0) {
      // After refresh/reopen we may not have the mnemonic in-memory anymore; send the user to Home where
      // backup reminders can still be handled (export + mark backed up) without completing Verify.
      router.navigate({ to: ROUTES.HOME, replace: true });
      return;
    }
    setWords(mnemonicWords);
  }, [mnemonicWords, router]);

  const quizIndexes = useMemo(() => buildQuizIndexes(words.length), [words.length]);

  const handleSubmit = async (answers: Record<number, string>) => {
    if (quizIndexes.length === 0 || pending) return;

    for (const index of quizIndexes) {
      const expected = words[index]?.trim().toLowerCase();
      const provided = answers[index]?.trim().toLowerCase();
      if (!expected || expected !== provided) {
        setError(`Word #${index + 1} does not match.`);
        return;
      }
    }

    setPending(true);
    setError(null);
    try {
      const keyringId = search.keyringId ?? mnemonicKeyringId;
      if (keyringId) await markBackedUp(keyringId);
      clearMnemonicWords();
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE, replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <VerifyMnemonicScreen
      quizIndexes={quizIndexes}
      pending={pending}
      error={error}
      onBack={() => router.navigate({ to: ROUTES.ONBOARDING_GENERATE, replace: true })}
      onSubmit={handleSubmit}
    />
  );
}
