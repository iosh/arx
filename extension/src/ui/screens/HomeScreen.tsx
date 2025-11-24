import type { UiSnapshot } from "@arx/core/ui";
import { Button, Card, H2, Paragraph, XStack, YStack } from "tamagui";
import { useIdleTimer } from "../hooks/useIdleTimer";

const MS_PER_SECOND = 1000;

type HomeScreenProps = {
  snapshot: UiSnapshot;
  onLock: () => Promise<unknown>;
  onNavigateAccounts: () => void;
  onNavigateNetworks: () => void;
  onNavigateApprovals: () => void;
};

export const HomeScreen = ({
  snapshot,
  onLock,
  onNavigateAccounts,
  onNavigateNetworks,
  onNavigateApprovals,
}: HomeScreenProps) => {
  useIdleTimer(snapshot.session.isUnlocked);

  const { chain, accounts, session, approvals } = snapshot;
  const timeLeft = session.nextAutoLockAt ? Math.max(session.nextAutoLockAt - Date.now(), 0) : null;
  const autoLockLabel =
    timeLeft !== null ? `${Math.ceil(timeLeft / MS_PER_SECOND)}s until auto lock` : "Auto lock paused";
  const hasApprovals = approvals.length > 0;
  const activeAccountLabel = accounts.active ?? "No active account";

  return (
    <YStack flex={1} padding="$4" gap="$4" backgroundColor="$backgroundStrong">
      <YStack gap="$3">
        <Card padded bordered>
          <YStack gap="$1">
            <Paragraph color="$color10" fontSize="$2">
              Current Chain
            </Paragraph>
            <H2>{chain.displayName}</H2>
            <Paragraph color="$color10" fontSize="$2">
              {chain.chainRef}
            </Paragraph>
          </YStack>
          <Button size="$3" marginTop="$2" onPress={onNavigateNetworks}>
            Switch Network
          </Button>
        </Card>

        <Card padded bordered>
          <YStack gap="$1">
            <Paragraph color="$color10" fontSize="$2">
              Active Account
            </Paragraph>
            <Paragraph fontSize="$5" fontWeight="600" fontFamily="$mono">
              {activeAccountLabel}
            </Paragraph>
            <Paragraph color="$color10" fontSize="$2">
              {accounts.list.length > 0
                ? `${accounts.list.length} account${accounts.list.length > 1 ? "s" : ""} available`
                : "No accounts available"}
            </Paragraph>
          </YStack>
          <Button size="$3" marginTop="$2" onPress={onNavigateAccounts}>
            Manage Accounts
          </Button>
        </Card>

        <Card padded bordered borderColor={hasApprovals ? "$orange7" : "$borderColor"}>
          <YStack gap="$1">
            <Paragraph color="$color10" fontSize="$2">
              Approvals
            </Paragraph>
            <Paragraph color={hasApprovals ? "$orange10" : "$color10"} fontWeight="600">
              {hasApprovals
                ? `${approvals.length} pending approval${approvals.length > 1 ? "s" : ""}`
                : "No pending approvals"}
            </Paragraph>
          </YStack>
          <Button size="$3" marginTop="$2" onPress={onNavigateApprovals}>
            Approval Center
          </Button>
        </Card>
      </YStack>

      <YStack gap="$2" paddingBottom="$2">
        <Card padded bordered backgroundColor="$backgroundFocus">
          <XStack alignItems="center" justifyContent="space-between">
            <Paragraph color="$color10" fontSize="$2">
              Session
            </Paragraph>
            <Paragraph color="$colorFocus">{autoLockLabel}</Paragraph>
          </XStack>
        </Card>

        <Button onPress={() => void onLock()}>Lock Wallet</Button>
      </YStack>
    </YStack>
  );
};
