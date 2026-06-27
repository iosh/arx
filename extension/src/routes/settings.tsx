import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Input, Paragraph, Slider, XStack } from "tamagui";
import { Button, Card, Divider, LoadingScreen, Screen } from "@/ui/components";
import { useRefreshUiSetupStatus, useUiSetupStatus } from "@/ui/hooks/useUiSetupStatus";
import { app } from "@/ui/lib/app";
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
  const setupStatusQuery = useUiSetupStatus();
  const refreshSetupStatus = useRefreshUiSetupStatus();
  const setAutoLockDurationMutation = useMutation({
    mutationFn: (durationMs: number) => app.wallet.session.setAutoLockDuration({ durationMs }),
    onSuccess: async () => {
      await refreshSetupStatus();
    },
  });
  const lockMutation = useMutation({
    mutationFn: () => app.wallet.session.lock(),
    onSuccess: async () => {
      await refreshSetupStatus();
    },
  });

  const [minutes, setMinutes] = useState(15);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionStatus = setupStatusQuery.data?.session;
  const autoLockDurationMs = sessionStatus?.autoLockDurationMs;
  useEffect(() => {
    if (autoLockDurationMs === undefined) return;
    const next = Math.round(autoLockDurationMs / 60000);
    setMinutes(clamp(next));
  }, [autoLockDurationMs]);

  const timeLeftLabel = useMemo(() => {
    const delta = sessionStatus?.nextAutoLockAt ? sessionStatus.nextAutoLockAt - Date.now() : null;
    if (delta === null) return "Auto-lock paused";
    return delta > 0 ? `${Math.ceil(delta / 1000)}s until lock` : "Locking soon";
  }, [sessionStatus?.nextAutoLockAt]);

  const handleSave = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await setAutoLockDurationMutation.mutateAsync(minutes * 60_000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (setupStatusQuery.isLoading || !sessionStatus) {
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
          <Button flex={1} onPress={() => void lockMutation.mutateAsync()} disabled={pending}>
            Lock now
          </Button>
        </XStack>
      </Card>
    </Screen>
  );
}
