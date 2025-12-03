import { Card, H2, Paragraph, YStack } from "tamagui";
import { Button } from "@/ui/components";

type SetupCompleteScreenProps = {
  onContinue: () => void;
};

export function SetupCompleteScreen({ onContinue }: SetupCompleteScreenProps) {
  return (
    <YStack flex={1} padding="$4" gap="$3" alignItems="center" justifyContent="center">
      <Card padded bordered gap="$2" alignItems="center">
        <H2>Wallet ready</H2>
        <Paragraph color="$color10" textAlign="center">
          Your first account is ready. You can start using ARX Wallet now.
        </Paragraph>
        <Button onPress={onContinue}>Go to dashboard</Button>
      </Card>
    </YStack>
  );
}
