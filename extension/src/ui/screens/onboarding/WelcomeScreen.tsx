import { Card, H2, Paragraph } from "tamagui";
import { Button, Screen } from "@/ui/components";

type WelcomeScreenProps = {
  onCreate: () => void;
  onImportMnemonic: () => void;
  onImportPrivateKey: () => void;
};

export function WelcomeScreen({ onCreate, onImportMnemonic, onImportPrivateKey }: WelcomeScreenProps) {
  return (
    <Screen scroll={false}>
      <Card gap="$3">
        <H2>Welcome to ARX Wallet</H2>
        <Paragraph color="$mutedText">
          Create a new wallet or restore an existing one. You will need to set a password first.
        </Paragraph>

        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">New wallet</Paragraph>
          <Paragraph color="$mutedText" fontSize="$2">
            Generate a recovery phrase and start with a fresh vault.
          </Paragraph>
          <Button variant="primary" onPress={onCreate}>
            Create password
          </Button>
        </Card>

        <Button onPress={onImportMnemonic}>Import seed phrase</Button>
        <Button onPress={onImportPrivateKey}>Import private key</Button>
      </Card>
    </Screen>
  );
}
