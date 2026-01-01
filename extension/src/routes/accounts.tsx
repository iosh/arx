import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Paragraph, XStack } from "tamagui";
import { AddressDisplay, Button, Card, ChainBadge, Divider, LoadingScreen, Screen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/accounts")({
  beforeLoad: requireVaultInitialized,
  component: AccountSwitchPage,
});

function AccountSwitchPage() {
  const router = useRouter();
  const { snapshot, isLoading, switchAccount, markBackedUp } = useUiSnapshot();
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const [backupError, setBackupError] = useState<string | null>(null);
  const backupWarnings = useMemo(
    () => snapshot?.warnings.hdKeyringsNeedingBackup ?? [],
    [snapshot?.warnings.hdKeyringsNeedingBackup],
  );

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  const handleAccountSwitch = async (address: string | null) => {
    if (pendingAddress) return;

    setErrorMessage(null);
    setPendingAddress(address);
    try {
      await switchAccount({ chainRef: snapshot.chain.chainRef, address });
      router.navigate({ to: ROUTES.HOME });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAddress(null);
    }
  };
  const handleMarkBackedUp = async (keyringId: string) => {
    setMarkingId(keyringId);
    setBackupError(null);
    try {
      await markBackedUp(keyringId);
    } catch (error) {
      setBackupError(getErrorMessage(error));
    } finally {
      setMarkingId((current) => (current === keyringId ? null : current));
    }
  };

  return (
    <Screen>
      {backupWarnings.length > 0 && (
        <Card padded bordered backgroundColor="$yellow2" gap="$2">
          <Paragraph fontWeight="600">Backup reminders</Paragraph>
          {backupWarnings.map((warning) => (
            <XStack key={warning.keyringId} alignItems="center" justifyContent="space-between" gap="$2">
              <Paragraph>{warning.alias ?? "HD keyring"} needs backup</Paragraph>
              <Button
                size="$2"
                loading={markingId === warning.keyringId}
                onPress={() => void handleMarkBackedUp(warning.keyringId)}
              >
                Mark backed up
              </Button>
            </XStack>
          ))}
          {backupError ? (
            <Paragraph color="$red10" fontSize="$2">
              {backupError}
            </Paragraph>
          ) : null}
        </Card>
      )}

      <Button onPress={() => router.navigate({ to: ROUTES.HOME })}>Back</Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Accounts
        </Paragraph>
        <ChainBadge chainRef={snapshot.chain.chainRef} displayName={snapshot.chain.displayName} size="sm" />

        <Divider marginVertical="$2" />

        {snapshot.accounts.list.length === 0 ? (
          <Paragraph color="$color10">No accounts available yet.</Paragraph>
        ) : (
          snapshot.accounts.list.map((address) => {
            const isActive = snapshot.accounts.active === address;
            const loading = pendingAddress === address;
            return (
              <Card key={address} padded bordered borderColor={isActive ? "$accent" : "$border"} gap="$2">
                <AddressDisplay
                  address={address}
                  namespace={snapshot.chain.namespace}
                  chainRef={snapshot.chain.chainRef}
                />
                <XStack alignItems="center" justifyContent="space-between">
                  <Paragraph color={isActive ? "$accent" : "$mutedText"} fontSize="$2">
                    {isActive ? "Active" : "Available"}
                  </Paragraph>
                  <Button size="$3" disabled={isActive || loading} onPress={() => void handleAccountSwitch(address)}>
                    {loading ? "Switching..." : isActive ? "Current" : "Switch"}
                  </Button>
                </XStack>
              </Card>
            );
          })
        )}
        {errorMessage ? (
          <Paragraph color="$red10" fontSize="$2">
            {errorMessage}
          </Paragraph>
        ) : null}
      </Card>

      <Card padded bordered gap="$2">
        <Paragraph fontWeight="600">Account Management</Paragraph>

        <Paragraph color="$color10" fontSize="$2">
          Additional account features are coming soon.
        </Paragraph>
        <Button disabled>Derive New Account</Button>
        <Button disabled>Import Private Key</Button>
      </Card>
    </Screen>
  );
}
