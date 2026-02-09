import type { UiSnapshot } from "@arx/core/ui";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  History,
  RefreshCw,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Paragraph, Spinner, Text, useTheme, XStack, YStack } from "tamagui";
import { AddressDisplay, BalanceDisplay, Button, ChainBadge, PasswordInput, Screen, Sheet } from "../components";
import { getErrorMessage } from "../lib/errorUtils";

type HomeScreenProps = {
  snapshot: UiSnapshot;
  backupWarnings: Array<{ keyringId: string; alias: string | null }>;
  nativeBalanceWei: string | null;
  nativeBalanceLoading: boolean;
  nativeBalanceRefreshing: boolean;
  nativeBalanceError: string | null;
  onRefreshNativeBalance: () => void;
  onMarkBackedUp: (keyringId: string) => Promise<void>;
  onExportMnemonic: (params: { keyringId: string; password: string }) => Promise<string[]>;
  markingKeyringId: string | null;
  onOpenApprovals: () => void;
  onNavigateAccounts: () => void;
  onNavigateNetworks: () => void;
  onNavigateSend: () => void;
  onNavigateSettings: () => void;
};

const QuickAction = ({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactElement;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) => {
  return (
    <YStack alignItems="center" gap="$2" opacity={disabled ? 0.5 : 1}>
      <Button
        size="$5"
        circular
        variant="secondary"
        onPress={onPress}
        disabled={disabled}
        icon={icon}
        aria-label={label}
        backgroundColor="$surface"
        hoverStyle={{ backgroundColor: "$cardBg" }}
        pressStyle={{ backgroundColor: "$border" }}
      />
      <Paragraph fontSize="$2" fontWeight="600" color="$mutedText">
        {label}
      </Paragraph>
    </YStack>
  );
};

export const HomeScreen = ({
  snapshot,
  nativeBalanceWei,
  nativeBalanceLoading,
  nativeBalanceRefreshing,
  nativeBalanceError,
  onRefreshNativeBalance,
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

  const [hideBalance, setHideBalance] = useState(false);
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
      // Prevent any in-flight export from updating state after unmount.
      exportRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    // Avoid keeping sensitive info around after closing/changing the sheet.

    exportRequestIdRef.current += 1; // invalidate any in-flight export request
    setExportPassword("");
    setExportWords(null);
    setExportError(null);
    setExporting(false);
  }, [confirmKeyringId]);

  return (
    <Screen padded={false} scroll>
      {/* Header Section */}
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

        <XStack gap="$2">
          {approvalsCount > 0 && (
            <Button
              size="$3"
              circular
              variant="danger"
              onPress={onOpenApprovals}
              icon={<Activity size={18} />}
              aria-label="Open pending requests"
            />
          )}
          <Button
            size="$3"
            variant="ghost"
            circular
            onPress={onNavigateSettings}
            icon={<Settings size={20} color={theme.text.get()} />}
            aria-label="Settings"
          />
        </XStack>
      </XStack>

      <YStack gap="$6" paddingBottom="$8">
        {/* Hero Section */}
        <YStack alignItems="center" gap="$2" paddingHorizontal="$4" paddingTop="$6" paddingBottom="$4">
          {/* Balance */}
          <YStack alignItems="center" gap="$1">
            <Paragraph color="$mutedText" fontSize="$2" fontWeight="600">
              Balance
            </Paragraph>

            {accounts.active ? (
              hideBalance ? (
                <XStack alignItems="baseline" gap="$2">
                  <Paragraph color="$text" fontSize="$5" fontWeight="600">
                    ••••
                  </Paragraph>
                  <Paragraph color="$mutedText" fontSize="$3">
                    {chain.nativeCurrency.symbol}
                  </Paragraph>
                  <XStack gap="$1">
                    <Button
                      size="$2"
                      variant="ghost"
                      circular
                      aria-label="Show balance"
                      icon={<Eye size={16} color={theme.text.get()} />}
                      onPress={() => setHideBalance(false)}
                    />
                    <Button
                      size="$2"
                      variant="ghost"
                      circular
                      aria-label="Refresh balance"
                      icon={<RefreshCw size={16} color={theme.text.get()} />}
                      onPress={onRefreshNativeBalance}
                      loading={nativeBalanceRefreshing}
                      spinnerPosition="replace"
                      disabled={nativeBalanceLoading}
                    />
                  </XStack>
                </XStack>
              ) : nativeBalanceLoading ? (
                <BalanceDisplay
                  amount="0"
                  symbol={chain.nativeCurrency.symbol}
                  decimals={chain.nativeCurrency.decimals}
                  loading
                  right={
                    <XStack gap="$1">
                      <Button
                        size="$2"
                        variant="ghost"
                        circular
                        aria-label="Hide balance"
                        icon={<EyeOff size={16} color={theme.text.get()} />}
                        onPress={() => setHideBalance(true)}
                      />
                      <Button
                        size="$2"
                        variant="ghost"
                        circular
                        aria-label="Refresh balance"
                        icon={<RefreshCw size={16} color={theme.text.get()} />}
                        onPress={onRefreshNativeBalance}
                        disabled
                      />
                    </XStack>
                  }
                />
              ) : nativeBalanceWei !== null ? (
                <BalanceDisplay
                  amount={nativeBalanceWei}
                  symbol={chain.nativeCurrency.symbol}
                  decimals={chain.nativeCurrency.decimals}
                  right={
                    <XStack gap="$1">
                      <Button
                        size="$2"
                        variant="ghost"
                        circular
                        aria-label="Hide balance"
                        icon={<EyeOff size={16} color={theme.text.get()} />}
                        onPress={() => setHideBalance(true)}
                      />
                      <Button
                        size="$2"
                        variant="ghost"
                        circular
                        aria-label="Refresh balance"
                        icon={<RefreshCw size={16} color={theme.text.get()} />}
                        onPress={onRefreshNativeBalance}
                        loading={nativeBalanceRefreshing}
                        spinnerPosition="replace"
                      />
                    </XStack>
                  }
                />
              ) : (
                <XStack alignItems="baseline" gap="$2">
                  <Paragraph color="$text" fontSize="$5" fontWeight="600">
                    —
                  </Paragraph>
                  <Paragraph color="$mutedText" fontSize="$3">
                    {chain.nativeCurrency.symbol}
                  </Paragraph>
                  <XStack gap="$1">
                    <Button
                      size="$2"
                      variant="ghost"
                      circular
                      aria-label="Hide balance"
                      icon={<EyeOff size={16} color={theme.text.get()} />}
                      onPress={() => setHideBalance(true)}
                    />
                    <Button
                      size="$2"
                      variant="ghost"
                      circular
                      aria-label="Refresh balance"
                      icon={<RefreshCw size={16} color={theme.text.get()} />}
                      onPress={onRefreshNativeBalance}
                      loading={nativeBalanceRefreshing}
                      spinnerPosition="replace"
                    />
                  </XStack>
                </XStack>
              )
            ) : (
              <Paragraph color="$mutedText" fontSize="$3">
                Select Account
              </Paragraph>
            )}

            {nativeBalanceError ? (
              <Paragraph color="$danger" fontSize="$2">
                {nativeBalanceError}
              </Paragraph>
            ) : null}
          </YStack>

          {/* Address */}
          <YStack alignItems="center" gap="$2">
            {accounts.active ? (
              <Button
                size="$3"
                variant="ghost"
                borderRadius="$full"
                paddingHorizontal="$2"
                hoverStyle={{ backgroundColor: "$surface" }}
                pressStyle={{ opacity: 0.7 }}
                onPress={onNavigateAccounts}
              >
                <XStack alignItems="center" gap="$2">
                  <AddressDisplay
                    address={accounts.active}
                    namespace={chain.namespace}
                    chainRef={chain.chainRef}
                    fontSize="$3"
                    fontWeight="500"
                    color="$mutedText"
                    copyable={false}
                    interactive={false}
                  />
                  <ChevronDown size={14} color={theme.mutedText.get()} />
                </XStack>
              </Button>
            ) : (
              <Button size="$2" variant="secondary" borderRadius="$full" onPress={onNavigateAccounts}>
                Select Account
              </Button>
            )}
          </YStack>
        </YStack>

        {/* Action Buttons */}
        <XStack justifyContent="space-evenly" paddingHorizontal="$4">
          <QuickAction
            icon={<ArrowUpRight size={24} color={theme.text.get()} />}
            label="Send"
            onPress={accounts.active ? onNavigateSend : undefined}
            disabled={!accounts.active}
          />
          <QuickAction
            icon={<History size={24} color={theme.text.get()} />}
            label="Activity"
            onPress={() => {}} // TODO: Implement Activity
          />
        </XStack>

        {/* Alerts & Tasks Section */}
        <YStack paddingHorizontal="$4" gap="$3">
          {approvalsCount > 0 && (
            <Button
              variant="secondary"
              backgroundColor="$cardBg"
              borderColor="$accent"
              borderRadius="$lg"
              padding="$4"
              onPress={onOpenApprovals}
              icon={<Activity size={20} color={theme.accent.get()} />}
              iconAfter={<ChevronRight size={20} color={theme.mutedText.get()} />}
              justifyContent="space-between"
            >
              <YStack gap="$1" alignItems="flex-start">
                <Paragraph fontWeight="600" fontSize="$4">
                  Pending Requests
                </Paragraph>
                <Paragraph color="$mutedText" fontSize="$3">
                  {approvalsCount} request{approvalsCount !== 1 ? "s" : ""} waiting
                </Paragraph>
              </YStack>
            </Button>
          )}

          {backupWarnings.map((warning) => {
            const alias = warning.alias ?? "Wallet";
            const markingThis = markingKeyringId === warning.keyringId;

            return (
              <Button
                key={warning.keyringId}
                variant="secondary"
                backgroundColor="$dangerBackground"
                borderColor="$danger"
                borderRadius="$lg"
                padding="$4"
                onPress={() => setConfirmKeyringId(warning.keyringId)}
              >
                <XStack gap="$3" alignItems="center" width="100%">
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
                    <Paragraph color="$mutedText" fontSize="$3">
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
                    key={`${index}-${word}`}
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
                  .catch(() => {});
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
