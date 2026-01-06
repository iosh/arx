import { Card, H2, Paragraph } from "tamagui";
import { Button, Screen } from "@/ui/components";

type SetupCompleteScreenProps = {
  onOpenWallet: () => void;
};

export function SetupCompleteScreen({ onOpenWallet }: SetupCompleteScreenProps) {
  return (
    <Screen>
      <Card padded bordered gap="$2" alignItems="center">
        <H2>Wallet ready</H2>
        <Paragraph color="$mutedText" textAlign="center">
          Onboarding is complete. Click the extension icon to open your wallet.
        </Paragraph>
        <Paragraph color="$mutedText" textAlign="center">
          You can close this tab.
        </Paragraph>
        <Button variant="primary" onPress={onOpenWallet}>
          Open wallet
        </Button>
      </Card>
    </Screen>
  );
}
