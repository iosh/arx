import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Paragraph, Separator, XStack, YStack } from "tamagui";
import { Button, LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/accounts")({
  component: AccountSwitchPage,
});

function AccountSwitchPage() {
  const router = useRouter();
  const { snapshot, isLoading, switchAccount } = useUiSnapshot();
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  const handleSelect = async (address: string | null) => {
    if (pendingAddress) {
      return;
    }

    setPendingAddress(address);
    try {
      await switchAccount({ chainRef: snapshot.chain.chainRef, address });
    } catch (error) {
      console.error("[AccountSwitch] Failed to switch account:", error);
      setPendingAddress(null);
      return;
    }

    setPendingAddress(null);
    router.navigate({ to: ROUTES.HOME });
  };

  return (
    <YStack flex={1} gap="$3" padding="$4">
      <Button onPress={() => router.navigate({ to: ROUTES.HOME })}>Back</Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Accounts
        </Paragraph>
        <Paragraph color="$colorMuted" fontSize="$2">
          Chain: {snapshot.chain.displayName} ({snapshot.chain.chainRef})
        </Paragraph>

        <Separator marginVertical="$2" />

        {snapshot.accounts.list.length === 0 ? (
          <Paragraph color="$colorMuted">No accounts available yet.</Paragraph>
        ) : (
          snapshot.accounts.list.map((address) => {
            const isActive = snapshot.accounts.active === address;
            const loading = pendingAddress === address;
            return (
              <Card key={address} padded bordered borderColor={isActive ? "$colorFocus" : "$borderColor"} gap="$2">
                <Paragraph fontFamily="$mono" fontSize="$3">
                  {address}
                </Paragraph>
                <XStack alignItems="center" justifyContent="space-between">
                  <Paragraph color={isActive ? "$colorFocus" : "$colorMuted"} fontSize="$2">
                    {isActive ? "Active" : "Available"}
                  </Paragraph>
                  <Button size="$3" disabled={isActive || loading} onPress={() => void handleSelect(address)}>
                    {loading ? "Switching..." : isActive ? "Current" : "Switch"}
                  </Button>
                </XStack>
              </Card>
            );
          })
        )}
      </Card>

      <Card padded bordered gap="$2">
        <Paragraph fontWeight="600">Account Management</Paragraph>
        <Paragraph color="$colorMuted" fontSize="$2">
          Additional account features are coming soon.
        </Paragraph>
        <Button disabled>Derive New Account</Button>
        <Button disabled>Import Private Key</Button>
      </Card>
    </YStack>
  );
}
