import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Input, Paragraph, Slider, XStack } from "tamagui";
import { Button, Card, Divider, LoadingScreen, Screen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/settings")({
  beforeLoad: requireVaultInitialized,
  component: SettingsPage,
});

const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

const clamp = (value: number) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(value)));

function SettingsPage() {
  const router = useRouter();
  const { snapshot, isLoading, setAutoLockDuration, lock } = useUiSnapshot();

  const [minutes, setMinutes] = useState(15);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync local state with snapshot when autoLockDurationMs changes
  const autoLockDurationMs = snapshot?.session.autoLockDurationMs;
  useEffect(() => {
    if (autoLockDurationMs === undefined) return;
    const next = Math.round(autoLockDurationMs / 60000);
    setMinutes(clamp(next));
  }, [autoLockDurationMs]);

  const timeLeftLabel = useMemo(() => {
    const delta = snapshot?.session.nextAutoLockAt ? snapshot.session.nextAutoLockAt - Date.now() : null;
    if (delta === null) return "Auto-lock paused";
    return delta > 0 ? `${Math.ceil(delta / 1000)}s until lock` : "Locking soon";
  }, [snapshot?.session?.nextAutoLockAt]);

  const handleSave = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await setAutoLockDuration(minutes * 60_000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  return (
    <Screen>
      <Button onPress={() => router.navigate({ to: ROUTES.HOME })} disabled={pending}>
        Back
      </Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Auto-lock
        </Paragraph>
        <Paragraph color="$mutedText" fontSize="$2">
          Choose how long the wallet stays unlocked (1–60 minutes).
        </Paragraph>
        <Divider marginVertical="$2" />

        <Paragraph fontWeight="600">Duration: {minutes} min</Paragraph>
        <Slider
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step={1}
          value={[minutes]}
          onValueChange={([value]) => setMinutes(clamp(value ?? minutes))}
        />

        <XStack gap="$2" alignItems="center">
          <Paragraph fontSize="$2">Manual:</Paragraph>
          <Input
            value={String(minutes)}
            onChangeText={(text) => setMinutes(clamp(Number.parseInt(text, 10) || minutes))}
            inputMode="numeric"
            width={80}
          />
          <Button size="$2" onPress={() => setMinutes(clamp(minutes - 1))}>
            -1
          </Button>
          <Button size="$2" onPress={() => setMinutes(clamp(minutes + 1))}>
            +1
          </Button>
        </XStack>

        <Paragraph color="$mutedText" fontSize="$2">
          {timeLeftLabel}
        </Paragraph>
        {error ? (
          <Paragraph color="$red10" fontSize="$2">
            {error}
          </Paragraph>
        ) : null}

        <XStack gap="$2" marginTop="$2">
          <Button flex={1} onPress={handleSave} loading={pending} disabled={pending}>
            Save
          </Button>
          <Button flex={1} onPress={() => void lock()} disabled={pending}>
            Lock now
          </Button>
        </XStack>
      </Card>
    </Screen>
  );
}
