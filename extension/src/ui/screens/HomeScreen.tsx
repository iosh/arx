import type { UiSnapshot } from "@arx/core/ui";
import { Activity, ChevronDown, ChevronRight, Settings, ShieldAlert, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Paragraph, Spinner, useTheme, XStack, YStack } from "tamagui";
import { AddressDisplay, Button, ChainBadge, Screen, Sheet } from "../components";

type HomeScreenProps = {
  snapshot: UiSnapshot;
  backupWarnings: Array<{ keyringId: string; alias: string | null }>;
  onMarkBackedUp: (keyringId: string) => Promise<void>;
  markingKeyringId: string | null;
  onOpenApprovals: () => void;
  onNavigateAccounts: () => void;
  onNavigateNetworks: () => void;
  onNavigateSettings: () => void;
};

export const HomeScreen = ({
  snapshot,
  onMarkBackedUp,
  onOpenApprovals,
  onNavigateAccounts,
  onNavigateNetworks,
  onNavigateSettings,
  backupWarnings,
  markingKeyringId,
}: HomeScreenProps) => {
  const theme = useTheme();
  const { chain, accounts } = snapshot;
  const approvalsCount = snapshot.approvals.length;

  const [confirmKeyringId, setConfirmKeyringId] = useState<string | null>(null);
  const confirmingWarning = useMemo(
    () => (confirmKeyringId ? (backupWarnings.find((w) => w.keyringId === confirmKeyringId) ?? null) : null),
    [backupWarnings, confirmKeyringId],
  );
  const confirmOpen = confirmKeyringId !== null;
  const confirmMarking = confirmKeyringId !== null && markingKeyringId === confirmKeyringId;

  return (
    <Screen padded={false}>
      <XStack padding="$4" alignItems="center" justifyContent="space-between">
        <Button
          size="$2"
          variant="secondary"
          onPress={onNavigateNetworks}
          aria-label={`Current network: ${chain.displayName}. Switch network`}
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderRadius="$full"
          hoverStyle={{ backgroundColor: "$surface" }}
          pressStyle={{ opacity: 0.6 }}
          icon={<ChainBadge chainRef={chain.chainRef} displayName={chain.displayName} size="sm" showChainRef={false} />}
          iconAfter={<ChevronDown size={14} color={theme.mutedText.get()} />}
        />

        <Button
          size="$3"
          variant="ghost"
          circular
          onPress={onNavigateSettings}
          icon={<Settings size={20} color={theme.text.get()} />}
        />
      </XStack>

      <YStack paddingHorizontal="$4" gap="$4" paddingBottom="$6">
        {approvalsCount > 0 ? (
          <Button
            variant="secondary"
            backgroundColor="$cardBg"
            borderColor="$accent"
            borderRadius="$lg"
            padding="$3"
            onPress={onOpenApprovals}
            icon={<Activity size={18} color={theme.accent.get()} />}
            iconAfter={<ChevronRight size={18} color={theme.mutedText.get()} />}
            aria-label="Open pending requests"
          >
            {approvalsCount} Pending Request{approvalsCount !== 1 ? "s" : ""}
          </Button>
        ) : null}

        <YStack alignItems="center" paddingVertical="$6" gap="$3">
          <YStack
            width={64}
            height={64}
            borderRadius={32}
            backgroundColor="$surface"
            alignItems="center"
            justifyContent="center"
            borderWidth={1}
            borderColor="$border"
          >
            <Wallet size={32} color={theme.text.get()} />
          </YStack>

          <YStack alignItems="center" gap="$1">
            {accounts.active ? (
              <AddressDisplay
                address={accounts.active}
                namespace={chain.namespace}
                chainRef={chain.chainRef}
                fontSize="$6"
                fontWeight="700"
              />
            ) : (
              <Paragraph fontSize="$5" fontWeight="700" color="$mutedText">
                No active account
              </Paragraph>
            )}

            <Button
              size="$2"
              variant="ghost"
              borderRadius="$full"
              alignSelf="center"
              aria-label="Manage accounts"
              onPress={onNavigateAccounts}
              pressStyle={{ opacity: 0.7 }}
              iconAfter={<ChevronRight size={14} color={theme.mutedText.get()} />}
              textProps={{ color: "$mutedText", fontSize: "$3" }}
            >
              {accounts.totalCount} Account{accounts.totalCount !== 1 ? "s" : ""}
            </Button>
          </YStack>
        </YStack>
        {backupWarnings.map((warning) => {
          const alias = warning.alias ?? "Wallet";
          const markingThis = markingKeyringId === warning.keyringId;

          return (
            <Button
              key={warning.keyringId}
              variant="secondary"
              backgroundColor="$cardBg"
              borderColor="$danger"
              borderRadius="$lg"
              padding="$3"
              animation="fast"
              hoverStyle={markingThis ? undefined : { backgroundColor: "$surface" }}
              pressStyle={markingThis ? undefined : { scale: 0.99 }}
              disabled={markingThis}
              onPress={() => setConfirmKeyringId(warning.keyringId)}
              aria-label={`Backup required for ${alias}. Open confirmation`}
            >
              <XStack alignItems="center" gap="$3">
                <YStack
                  width={40}
                  height={40}
                  borderRadius="$full"
                  backgroundColor="$danger"
                  alignItems="center"
                  justifyContent="center"
                >
                  <ShieldAlert size={20} color={theme.dangerText.get()} />
                </YStack>
                <YStack flex={1} gap="$0.5">
                  <Paragraph fontWeight="700" fontSize="$4">
                    Backup Required
                  </Paragraph>
                  <Paragraph color="$mutedText" fontSize="$2">
                    {alias} needs backup
                  </Paragraph>
                </YStack>
                {markingThis ? (
                  <Spinner size="small" color="$mutedText" />
                ) : (
                  <ChevronRight size={20} color={theme.mutedText.get()} />
                )}
              </XStack>
            </Button>
          );
        })}

        <Sheet
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open && confirmMarking) return;
            if (!open) setConfirmKeyringId(null);
          }}
          title="Confirm backup"
          dismissOnOverlayPress={false}
        >
          <Paragraph color="$mutedText" fontSize="$2">
            Only mark this as backed up if you have securely saved the recovery phrase for{" "}
            {confirmingWarning?.alias ?? "this wallet"}.
          </Paragraph>

          <XStack gap="$2">
            <Button flex={1} variant="secondary" onPress={() => setConfirmKeyringId(null)} disabled={confirmMarking}>
              Cancel
            </Button>
            <Button
              flex={1}
              variant="primary"
              loading={confirmMarking}
              disabled={!confirmingWarning || confirmMarking}
              onPress={() => {
                if (!confirmingWarning) return;
                void onMarkBackedUp(confirmingWarning.keyringId)
                  .then(() => setConfirmKeyringId(null))
                  .catch(() => {});
              }}
            >
              Mark backed up
            </Button>
          </XStack>
        </Sheet>
      </YStack>
    </Screen>
  );
};
