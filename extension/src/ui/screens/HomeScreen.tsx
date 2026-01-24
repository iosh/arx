import type { UiSnapshot } from "@arx/core/ui";
import { Activity, ChevronDown, ChevronRight, Settings, ShieldAlert, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Paragraph, Spinner, useTheme, XStack, YStack } from "tamagui";
import { AddressDisplay, Button, ChainBadge, PasswordInput, Screen, Sheet } from "../components";
import { getErrorMessage } from "../lib/errorUtils";

type HomeScreenProps = {
  snapshot: UiSnapshot;
  backupWarnings: Array<{ keyringId: string; alias: string | null }>;
  onMarkBackedUp: (keyringId: string) => Promise<void>;
  onExportMnemonic: (params: { keyringId: string; password: string }) => Promise<string[]>;
  markingKeyringId: string | null;
  onOpenApprovals: () => void;
  onNavigateAccounts: () => void;
  onNavigateNetworks: () => void;
  onNavigateSettings: () => void;
};

export const HomeScreen = ({
  snapshot,
  onMarkBackedUp,
  onExportMnemonic,
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
            if (!open && (confirmMarking || exporting)) return;
            if (!open) setConfirmKeyringId(null);
          }}
          title="Confirm backup"
          dismissOnOverlayPress={false}
        >
          <Paragraph color="$mutedText" fontSize="$2">
            Only mark this as backed up if you have securely saved the recovery phrase for{" "}
            {confirmingWarning?.alias ?? "this wallet"}.
          </Paragraph>

          <YStack gap="$3" marginTop="$4">
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
                  <Paragraph color="$danger" fontSize="$2">
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
          </YStack>

          <XStack gap="$2">
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
        </Sheet>
      </YStack>
    </Screen>
  );
};
