import type { UiSnapshot } from "@arx/core/ui";
import { Card, H2, Paragraph, XStack, YStack } from "tamagui";
import { Button, Screen } from "../components";

const MS_PER_SECOND = 1000;

type HomeScreenProps = {
  snapshot: UiSnapshot;
  backupWarnings: Array<{ keyringId: string; alias: string | null }>;
  onMarkBackedUp: (keyringId: string) => Promise<void>;
  markingKeyringId: string | null;
  onLock: () => Promise<unknown>;
  onNavigateAccounts: () => void;
  onNavigateNetworks: () => void;
  onNavigateApprovals: () => void;
  onNavigateSettings: () => void;
};

export const HomeScreen = ({
  snapshot,
  onLock,
  onMarkBackedUp,
  onNavigateAccounts,
  onNavigateNetworks,
  onNavigateApprovals,
  onNavigateSettings,
  backupWarnings,
  markingKeyringId,
}: HomeScreenProps) => {
  const { chain, accounts, session, approvals } = snapshot;
  const timeLeft = session.nextAutoLockAt ? Math.max(session.nextAutoLockAt - Date.now(), 0) : null;
  const autoLockLabel =
    timeLeft !== null ? `${Math.ceil(timeLeft / MS_PER_SECOND)}s until auto lock` : "Auto lock paused";
  const hasApprovals = approvals.length > 0;
  const activeAccountLabel = accounts.active ?? "No active account";

  return (
    <Screen>
      {backupWarnings.length > 0 && (
        <Card padded bordered backgroundColor="$yellow2" gap="$2">
          <Paragraph fontWeight="600">Backup required</Paragraph>
          {backupWarnings.map((warning) => (
            <XStack key={warning.keyringId} alignItems="center" justifyContent="space-between" gap="$2">
              <Paragraph fontSize="$3">{warning.alias ?? "HD keyring"} needs backup</Paragraph>
              <Button
                size="$2"
                onPress={() => onMarkBackedUp(warning.keyringId)}
                loading={markingKeyringId === warning.keyringId}
              >
                Mark backed up
              </Button>
            </XStack>
          ))}
        </Card>
      )}

      <YStack gap="$3">
        <Card padded bordered>
          <YStack gap="$1">
            <Paragraph color="$mutedText" fontSize="$2">
              Current Chain
            </Paragraph>
            <H2>{chain.displayName}</H2>
            <Paragraph color="$mutedText" fontSize="$2">
              {chain.chainRef}
            </Paragraph>
          </YStack>
          <Button size="$3" marginTop="$2" onPress={onNavigateNetworks}>
            Switch Network
          </Button>
        </Card>

        <Card padded bordered>
          <YStack gap="$1">
            <Paragraph color="$mutedText" fontSize="$2">
              Active Account
            </Paragraph>
            <Paragraph fontSize="$5" fontWeight="600" fontFamily="$mono">
              {activeAccountLabel}
            </Paragraph>
            <Paragraph color="$mutedText" fontSize="$2">
              {accounts.list.length > 0
                ? `${accounts.list.length} account${accounts.list.length > 1 ? "s" : ""} available`
                : "No accounts available"}
            </Paragraph>
          </YStack>
          <Button size="$3" marginTop="$2" onPress={onNavigateAccounts}>
            Manage Accounts
          </Button>
        </Card>

        <Card padded bordered borderColor={hasApprovals ? "$accent" : "$border"}>
          <YStack gap="$1">
            <Paragraph color="$mutedText" fontSize="$2">
              Approvals
            </Paragraph>
            <Paragraph color={hasApprovals ? "$accent" : "$mutedText"} fontWeight="600">
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
        <Card padded bordered backgroundColor="$surface">
          <XStack alignItems="center" justifyContent="space-between">
            <Paragraph color="$mutedText" fontSize="$2">
              Session
            </Paragraph>
            <Paragraph color="$colorFocus">{autoLockLabel}</Paragraph>
          </XStack>
        </Card>

        <Button size="$3" marginTop="$2" onPress={onNavigateSettings}>
          Settings / Auto-lock
        </Button>

        <Button onPress={() => void onLock()}>Lock Wallet</Button>
      </YStack>
    </Screen>
  );
};
