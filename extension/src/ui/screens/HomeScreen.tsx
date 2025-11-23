import type { UiSnapshot } from "@arx/core/ui";
import { Button, H2, Paragraph, YStack } from "tamagui";
import { useIdleTimer } from "../hooks/useIdleTimer";

type HomeScreenProps = {
  snapshot: UiSnapshot;
  onLock: () => Promise<unknown>;
};

export const HomeScreen = ({ snapshot, onLock }: HomeScreenProps) => {
  useIdleTimer(snapshot.session.isUnlocked);

  const timeLeft = snapshot.session.nextAutoLockAt ? Math.max(snapshot.session.nextAutoLockAt - Date.now(), 0) : null;

  return (
    <YStack flex={1} padding="$4" gap="$4" justifyContent="space-between">
      <YStack gap="$3">
        <YStack gap="$1">
          <Paragraph color="$colorMuted">Current Chain</Paragraph>
          <H2>{snapshot.chain.displayName}</H2>
          <Paragraph color="$colorMuted" fontSize="$2">
            {snapshot.chain.chainRef}
          </Paragraph>
        </YStack>
        <YStack gap="$1">
          <Paragraph color="$colorMuted">Active Account</Paragraph>
          <Paragraph fontSize="$5" fontWeight="600" fontFamily="$mono">
            {snapshot.accounts.active ?? "None"}
          </Paragraph>
        </YStack>
        {snapshot.approvals.length > 0 ? (
          <Paragraph color="$orange10" fontWeight="600">
            {snapshot.approvals.length} pending approval(s)
          </Paragraph>
        ) : null}
      </YStack>

      <YStack gap="$2">
        {timeLeft !== null ? (
          <Paragraph color="$colorMuted">Auto lock in {Math.ceil(timeLeft / 1000)}s</Paragraph>
        ) : null}
        <Button onPress={() => void onLock()}>Lock Wallet</Button>
      </YStack>
    </YStack>
  );
};
