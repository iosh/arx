import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Paragraph, XStack, YStack } from "tamagui";
import { Button, LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireUnlocked } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/networks")({
  beforeLoad: requireUnlocked,
  component: NetworkSwitchPage,
});

function NetworkSwitchPage() {
  const router = useRouter();
  const { snapshot, isLoading, switchChain } = useUiSnapshot();
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  const activeNetwork = snapshot.networks.known.find((item) => item.chainRef === snapshot.networks.active);

  const handleChainSwitch = async (chainRef: string) => {
    setPendingRef(chainRef);
    setErrorMessage(null);
    try {
      await switchChain(chainRef);
      router.navigate({ to: ROUTES.HOME });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingRef(null);
    }
  };

  return (
    <YStack flex={1} gap="$3" padding="$4">
      <Button onPress={() => router.navigate({ to: ROUTES.HOME })}>Back</Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Networks
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          Active chain: {activeNetwork?.displayName ?? snapshot.networks.active}
        </Paragraph>

        {snapshot.networks.known.length === 0 ? (
          <Paragraph color="$color10" marginTop="$2">
            No registered networks.
          </Paragraph>
        ) : (
          snapshot.networks.known.map((item) => {
            const isActive = snapshot.networks.active === item.chainRef;
            const loading = pendingRef === item.chainRef;
            return (
              <Card
                key={item.chainRef}
                padded
                bordered
                borderColor={isActive ? "$colorFocus" : "$borderColor"}
                gap="$2"
              >
                <Paragraph fontWeight="600">{item.displayName}</Paragraph>
                <Paragraph color="$color10" fontSize="$2">
                  {item.chainRef}
                </Paragraph>
                <XStack alignItems="center" justifyContent="space-between">
                  <Paragraph color={isActive ? "$colorFocus" : "$color10"} fontSize="$2">
                    {isActive ? "Active" : "Available"}
                  </Paragraph>
                  <Button
                    size="$3"
                    disabled={isActive || loading}
                    onPress={() => void handleChainSwitch(item.chainRef)}
                  >
                    {loading ? "Switching..." : isActive ? "Current" : "Switch"}
                  </Button>
                </XStack>
              </Card>
            );
          })
        )}
      </Card>

      {errorMessage ? (
        <Card padded bordered borderColor="$red7" backgroundColor="$red2">
          <Paragraph color="$red10" fontSize="$2">
            {errorMessage}
          </Paragraph>
        </Card>
      ) : null}
    </YStack>
  );
}
