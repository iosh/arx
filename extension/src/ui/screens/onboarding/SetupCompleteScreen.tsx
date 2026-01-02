import { Card, H2, Paragraph, YStack } from "tamagui";
import { Button, Screen } from "@/ui/components";

type SetupCompleteScreenProps = {
  onContinue: () => void;
};

export function SetupCompleteScreen({ onContinue }: SetupCompleteScreenProps) {
  return (
    <Screen scroll={false}>
      <YStack flex={1} alignItems="center" justifyContent="center">
        <Card padded bordered gap="$2" alignItems="center">
          <H2>Wallet ready</H2>
          <Paragraph color="$mutedText" textAlign="center">
            Setup is complete. Click the extension icon to open your wallet.
          </Paragraph>
          <Paragraph color="$mutedText" textAlign="center">
            You can close this tab.
          </Paragraph>
          <Button variant="primary" onPress={onContinue}>
            Close tab
          </Button>
        </Card>
      </YStack>
    </Screen>
  );
}
