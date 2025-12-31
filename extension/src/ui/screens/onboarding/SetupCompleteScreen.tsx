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
            Your first account is ready. You can start using ARX Wallet now.
          </Paragraph>
          <Button variant="primary" onPress={onContinue}>
            Go to dashboard
          </Button>
        </Card>
      </YStack>
    </Screen>
  );
}
