import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { mnemonicSession } from "@/ui/lib/mnemonicSession";
import { requireSetupIncomplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { VerifyMnemonicScreen } from "@/ui/screens/onboarding/VerifyMnemonicScreen";

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

export const Route = createFileRoute("/setup/verify")({
  beforeLoad: requireSetupIncomplete,
  component: VerifyMnemonicRoute,
});
function VerifyMnemonicRoute() {
  const router = useRouter();
  const { confirmNewMnemonic } = useUiSnapshot();
  const [words, setWords] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = mnemonicSession.peek();
    if (!cached || cached.length === 0) {
      router.navigate({ to: ROUTES.SETUP_GENERATE });
      return;
    }
    setWords(cached);
  }, [router]);

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
      await confirmNewMnemonic({ words, skipBackup: false });
      mnemonicSession.clear();
      router.navigate({ to: ROUTES.SETUP_COMPLETE });
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
      onBack={() => router.navigate({ to: ROUTES.SETUP_GENERATE })}
      onSubmit={handleSubmit}
    />
  );
}
