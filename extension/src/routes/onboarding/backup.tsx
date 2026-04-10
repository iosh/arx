import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { buildBackupEntryRedirect } from "@/ui/lib/onboardingFlow";
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

export const Route = createFileRoute("/onboarding/backup")({
  component: VerifyMnemonicRoute,
});
function VerifyMnemonicRoute() {
  const router = useRouter();
  const { snapshot, markBackedUp } = useUiSnapshot();
  const mnemonicWords = useOnboardingStore((s) => s.mnemonicWords);
  const mnemonicKeyringId = useOnboardingStore((s) => s.mnemonicKeyringId);
  const clearMnemonicWords = useOnboardingStore((s) => s.clearMnemonicWords);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = mnemonicWords ?? [];

  useEffect(() => {
    const redirect = buildBackupEntryRedirect({ snapshot, mnemonicWords, mnemonicKeyringId });
    if (redirect) {
      router.navigate(redirect);
    }
  }, [mnemonicKeyringId, mnemonicWords, router, snapshot]);

  const quizIndexes = useMemo(() => buildQuizIndexes(words.length), [words.length]);

  const handleSubmit = async (answers: Record<number, string>) => {
    if (quizIndexes.length === 0 || isSubmitting) return;

    for (const index of quizIndexes) {
      const expected = words[index]?.trim().toLowerCase();
      const provided = answers[index]?.trim().toLowerCase();
      if (!expected || expected !== provided) {
        setError(`Word #${index + 1} does not match.`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const keyringId = mnemonicKeyringId ?? snapshot?.backup.nextHdKeyring?.keyringId;
      if (keyringId) await markBackedUp(keyringId);
      clearMnemonicWords();
      router.navigate({ to: ROUTES.ONBOARDING_COMPLETE, replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <VerifyMnemonicScreen
      quizIndexes={quizIndexes}
      isSubmitting={isSubmitting}
      error={error}
      onAnswerChange={() => {
        if (error) setError(null);
      }}
      onBack={() => router.navigate({ to: ROUTES.ONBOARDING_CREATE, replace: true })}
      onSkip={() => {
        clearMnemonicWords();
        router.navigate({ to: ROUTES.ONBOARDING_COMPLETE, replace: true });
      }}
      onSubmit={handleSubmit}
    />
  );
}
