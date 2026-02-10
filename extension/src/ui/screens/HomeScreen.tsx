import type { UiSnapshot } from "@arx/core/ui";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  RefreshCcw,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Paragraph, SizableText, Spinner, Text, useTheme, XStack, YStack } from "tamagui";
import { pushToast } from "@/ui/lib/toast";
import {
  AccountCard,
  Button,
  Card,
  ChainBadge,
  PasswordInput,
  Screen,
  Sheet,
  Tabs,
  TokenListItem,
} from "../components";
import { getErrorMessage } from "../lib/errorUtils";

type HomeScreenProps = {
  snapshot: UiSnapshot;
  backupWarnings: Array<{ keyringId: string; alias: string | null }>;
  nativeBalanceWei: string | null;
  nativeBalanceLoading: boolean;
  nativeBalanceError: string | null;
  onMarkBackedUp: (keyringId: string) => Promise<void>;
  onExportMnemonic: (params: { keyringId: string; password: string }) => Promise<string[]>;
  markingKeyringId: string | null;
  onOpenApprovals: () => void;
  onNavigateAccounts: () => void;
  onNavigateNetworks: () => void;
  onNavigateSend: () => void;
  onNavigateSettings: () => void;
};

type QuickActionProps = {
  icon: React.ReactElement;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
};

const QuickAction = ({ icon, label, onPress, disabled }: QuickActionProps) => {
  return (
    <YStack alignItems="center" gap="$2" opacity={disabled ? 0.4 : 1}>
      <Button
        size="$5"
        circular
        variant="secondary"
        onPress={onPress}
        disabled={disabled}
        icon={icon}
        aria-label={label}
        backgroundColor="$surface"
        hoverStyle={{ backgroundColor: disabled ? "$surface" : "$cardBg" }}
        pressStyle={{ backgroundColor: disabled ? "$surface" : "$border" }}
      />
      <Paragraph fontSize="$2" fontWeight="500" color={disabled ? "$mutedText" : "$text"}>
        {label}
      </Paragraph>
    </YStack>
  );
};

const HOME_TABS = [
  { value: "tokens", label: "Tokens" },
  { value: "activity", label: "Activity" },
] as const;

type HomeTab = (typeof HOME_TABS)[number]["value"];

export const HomeScreen = ({
  snapshot,
  nativeBalanceWei,
  nativeBalanceLoading,
  nativeBalanceError,
  onMarkBackedUp,
  onExportMnemonic,
  onOpenApprovals,
  onNavigateAccounts,
  onNavigateNetworks,
  onNavigateSend,
  onNavigateSettings,
  backupWarnings,
  markingKeyringId,
}: HomeScreenProps) => {
  const theme = useTheme();
  const { chain, accounts } = snapshot;
  const approvalsCount = snapshot.approvals.length;

  const [activeTab, setActiveTab] = useState<HomeTab>("tokens");

  // Backup sheet state
  const [confirmKeyringId, setConfirmKeyringId] = useState<string | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [exportWords, setExportWords] = useState<string[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportRequestIdRef = useRef(0);

  const confirmingWarning = useMemo(
    () => (confirmKeyringId ? (backupWarnings.find((w) => w.keyringId === confirmKeyringId) ?? null) : null),
    [backupWarnings, confirmKeyringId],
  );
  const confirmOpen = confirmKeyringId !== null;
  const confirmMarking = confirmKeyringId !== null && markingKeyringId === confirmKeyringId;

  useEffect(() => {
    return () => {
      exportRequestIdRef.current += 1;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset export state when sheet keyring changes/closes
  useEffect(() => {
    exportRequestIdRef.current += 1;
    setExportPassword("");
    setExportWords(null);
    setExportError(null);
    setExporting(false);
  }, [confirmKeyringId]);

  const hasAlerts = approvalsCount > 0 || backupWarnings.length > 0;

  return (
    <Screen padded={false} scroll>
      {/* Header */}
      <XStack paddingHorizontal="$4" paddingVertical="$2" alignItems="center" justifyContent="space-between">
        <Button
          size="$3"
          variant="ghost"
          onPress={onNavigateNetworks}
          aria-label={`Current network: ${chain.displayName}. Switch network`}
          paddingHorizontal="$2"
          borderRadius="$full"
          hoverStyle={{ backgroundColor: "$surface" }}
          icon={<ChainBadge chainRef={chain.chainRef} displayName={chain.displayName} size="sm" showChainRef={false} />}
          iconAfter={<ChevronDown size={16} color={theme.mutedText.get()} />}
        />

        <Button
          size="$3"
          variant="ghost"
          circular
          onPress={onNavigateSettings}
          icon={<Settings size={20} color={theme.text.get()} />}
          aria-label="Settings"
        />
      </XStack>

      <YStack gap="$2" paddingBottom="$4">
        {/* Account Card */}
        <YStack paddingHorizontal="$4">
          <AccountCard
            address={accounts.active}
            chainRef={chain.chainRef}
            balanceWei={nativeBalanceWei}
            balanceLoading={nativeBalanceLoading}
            balanceError={nativeBalanceError}
            nativeSymbol={chain.nativeCurrency.symbol}
            nativeDecimals={chain.nativeCurrency.decimals}
            onPressAccount={onNavigateAccounts}
          />
        </YStack>

        {/* Quick Actions */}
        <XStack justifyContent="space-around" paddingHorizontal="$4">
          <QuickAction
            icon={<ArrowUpRight size={24} color={theme.text.get()} />}
            label="Send"
            onPress={accounts.active ? onNavigateSend : undefined}
            disabled={!accounts.active}
          />
          <QuickAction icon={<ArrowDownLeft size={24} color={theme.mutedText.get()} />} label="Receive" disabled />
          <QuickAction icon={<RefreshCcw size={24} color={theme.mutedText.get()} />} label="Swap" disabled />
          <QuickAction icon={<MoreHorizontal size={24} color={theme.mutedText.get()} />} label="More" disabled />
        </XStack>

        {/* Alerts Section */}
        {hasAlerts && (
          <YStack paddingHorizontal="$4" gap="$2">
            {approvalsCount > 0 && (
              <Card
                padded
                bordered
                borderColor="$accent"
                backgroundColor="$cardBg"
                pressStyle={{ opacity: 0.9 }}
                onPress={onOpenApprovals}
                cursor="pointer"
              >
                <XStack alignItems="center" justifyContent="space-between">
                  <XStack alignItems="center" gap="$3">
                    <YStack
                      width={36}
                      height={36}
                      borderRadius="$full"
                      backgroundColor="$accent"
                      alignItems="center"
                      justifyContent="center"
                      opacity={0.15}
                    >
                      <Activity size={18} color={theme.accent.get()} />
                    </YStack>
                    <YStack gap="$0.5">
                      <Paragraph fontWeight="600" fontSize="$3" color="$text">
                        Pending Requests
                      </Paragraph>
                      <Paragraph color="$mutedText" fontSize="$2">
                        {approvalsCount} request{approvalsCount !== 1 ? "s" : ""} waiting
                      </Paragraph>
                    </YStack>
                  </XStack>
                  <ChevronRight size={18} color={theme.mutedText.get()} />
                </XStack>
              </Card>
            )}

            {backupWarnings.map((warning) => {
              const alias = warning.alias ?? "Wallet";
              const markingThis = markingKeyringId === warning.keyringId;

              return (
                <Card
                  key={warning.keyringId}
                  padded
                  bordered
                  borderColor="$danger"
                  backgroundColor="$dangerBackground"
                  pressStyle={{ opacity: 0.9 }}
                  onPress={() => setConfirmKeyringId(warning.keyringId)}
                  cursor="pointer"
                >
                  <XStack alignItems="center" justifyContent="space-between">
                    <XStack alignItems="center" gap="$3">
                      <YStack
                        width={36}
                        height={36}
                        borderRadius="$full"
                        backgroundColor="$danger"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <ShieldAlert size={18} color={theme.dangerText.get()} />
                      </YStack>
                      <YStack gap="$0.5">
                        <Paragraph fontWeight="600" fontSize="$3" color="$text">
                          Backup Required
                        </Paragraph>
                        <Paragraph color="$mutedText" fontSize="$2">
                          {alias} needs backup
                        </Paragraph>
                      </YStack>
                    </XStack>
                    {markingThis ? (
                      <Spinner size="small" color="$mutedText" />
                    ) : (
                      <ChevronRight size={18} color={theme.mutedText.get()} />
                    )}
                  </XStack>
                </Card>
              );
            })}
          </YStack>
        )}

        {/* Tabs */}
        <YStack flex={1}>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as HomeTab)}
            orientation="horizontal"
            width="100%"
            flexDirection="column"
          >
            <Tabs.List width="100%" borderBottomWidth={1} borderColor="$border" paddingHorizontal="$4">
              {HOME_TABS.map((tab) => {
                const isActive = tab.value === activeTab;

                return (
                  <Tabs.Tab
                    key={tab.value}
                    value={tab.value}
                    flex={1}
                    alignItems="center"
                    justifyContent="center"
                    disableActiveTheme
                    paddingVertical="$3"
                    paddingHorizontal="$2"
                    borderBottomWidth={2}
                    borderColor={isActive ? "$primary" : "transparent"}
                    borderWidth={0}
                    borderRadius={0}
                    backgroundColor="transparent"
                    outlineWidth={0}
                    outlineColor="transparent"
                    marginBottom={-1}
                    hoverStyle={{ backgroundColor: "transparent", borderColor: isActive ? "$primary" : "$border" }}
                    pressStyle={{ backgroundColor: "transparent", opacity: 0.7 }}
                    focusStyle={{ backgroundColor: "transparent" }}
                    focusVisibleStyle={{ outlineWidth: 0 }}
                  >
                    <SizableText
                      size="$3"
                      color={isActive ? "$primary" : "$mutedText"}
                      fontWeight={isActive ? "600" : "500"}
                    >
                      {tab.label}
                    </SizableText>
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>

            <Tabs.Content value="tokens">
              <YStack paddingVertical="$2">
                <TokenListItem
                  symbol={chain.nativeCurrency.symbol}
                  name={chain.nativeCurrency.name}
                  balanceRaw={nativeBalanceWei}
                  decimals={chain.nativeCurrency.decimals}
                  loading={nativeBalanceLoading}
                />
              </YStack>
            </Tabs.Content>

            <Tabs.Content value="activity">
              <YStack paddingVertical="$2">
                <YStack padding="$8" alignItems="center" justifyContent="center">
                  <Paragraph color="$mutedText" fontSize="$3">
                    No recent activity
                  </Paragraph>
                </YStack>
              </YStack>
            </Tabs.Content>
          </Tabs>
        </YStack>
      </YStack>

      {/* Backup Confirmation Sheet */}
      <Sheet
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && (confirmMarking || exporting)) return;
          if (!open) setConfirmKeyringId(null);
        }}
        title="Confirm backup"
        dismissOnOverlayPress={false}
      >
        <Paragraph color="$mutedText" fontSize="$3" lineHeight="$4">
          Only mark this as backed up if you have securely saved the recovery phrase for{" "}
          <Text fontWeight="700" color="$text">
            {confirmingWarning?.alias ?? "this wallet"}
          </Text>
          .
        </Paragraph>

        <YStack gap="$4" marginTop="$4">
          {exportWords ? (
            <YStack
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$border"
              borderRadius="$md"
              padding="$3"
              gap="$3"
            >
              <Paragraph fontWeight="700">Recovery phrase</Paragraph>
              <XStack flexWrap="wrap" gap="$2" justifyContent="center">
                {exportWords.map((word, index) => (
                  <XStack
                    // biome-ignore lint/suspicious/noArrayIndexKey: mnemonic word list is fixed order and never re-sorted
                    key={index}
                    backgroundColor="$bg"
                    borderWidth={1}
                    borderColor="$border"
                    borderRadius="$sm"
                    paddingHorizontal="$3"
                    paddingVertical="$2"
                    alignItems="center"
                    gap="$2"
                    minWidth={90}
                  >
                    <Paragraph color="$mutedText" fontSize="$2" fontWeight="500">
                      {index + 1}.
                    </Paragraph>
                    <Paragraph color="$text" fontWeight="600" fontSize="$3">
                      {word}
                    </Paragraph>
                  </XStack>
                ))}
              </XStack>
            </YStack>
          ) : (
            <>
              <PasswordInput
                label="Password"
                value={exportPassword}
                onChangeText={setExportPassword}
                disabled={!confirmingWarning || exporting || confirmMarking}
              />

              {exportError ? (
                <Paragraph color="$danger" fontSize="$3">
                  {exportError}
                </Paragraph>
              ) : null}

              <Button
                variant="secondary"
                disabled={!confirmingWarning || exporting || confirmMarking || exportPassword.trim().length === 0}
                loading={exporting}
                onPress={() => {
                  if (!confirmingWarning || exporting) return;
                  const requestId = exportRequestIdRef.current + 1;
                  exportRequestIdRef.current = requestId;
                  setExporting(true);
                  setExportError(null);
                  void onExportMnemonic({ keyringId: confirmingWarning.keyringId, password: exportPassword })
                    .then((words) => {
                      if (exportRequestIdRef.current !== requestId) return;
                      setExportPassword("");
                      setExportWords(words);
                    })
                    .catch((err) => {
                      if (exportRequestIdRef.current !== requestId) return;
                      setExportError(getErrorMessage(err));
                    })
                    .finally(() => {
                      if (exportRequestIdRef.current !== requestId) return;
                      setExporting(false);
                    });
                }}
              >
                View recovery phrase
              </Button>
            </>
          )}

          <XStack gap="$3" marginTop="$2">
            <Button
              flex={1}
              variant="secondary"
              onPress={() => setConfirmKeyringId(null)}
              disabled={confirmMarking || exporting}
            >
              Cancel
            </Button>
            <Button
              flex={1}
              variant="primary"
              loading={confirmMarking}
              disabled={!confirmingWarning || confirmMarking || exporting}
              onPress={() => {
                if (!confirmingWarning) return;
                void onMarkBackedUp(confirmingWarning.keyringId)
                  .then(() => setConfirmKeyringId(null))
                  .catch((err) => {
                    console.warn("[HomeScreen] failed to mark backed up", err);
                    pushToast({
                      kind: "error",
                      message: "Failed to update backup status",
                      dedupeKey: "backup-status-failed",
                    });
                  });
              }}
            >
              Mark backed up
            </Button>
          </XStack>
        </YStack>
      </Sheet>
    </Screen>
  );
};
