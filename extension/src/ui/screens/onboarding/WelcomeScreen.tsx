import { Card, H2, Paragraph, YStack } from "tamagui";
import { Button } from "@/ui/components";

type WelcomeScreenProps = {
  onCreate: () => void;
  onImportMnemonic: () => void;
  onImportPrivateKey: () => void;
};

export function WelcomeScreen({ onCreate, onImportMnemonic, onImportPrivateKey }: WelcomeScreenProps) {
  return (
    <YStack flex={1} padding="$4" gap="$3" backgroundColor="$backgroundStrong">
      <Card>
        <H2>Welcome to ARX Wallet</H2>
        <Paragraph color="$color10">
          Create a new wallet or restore an existing one. You will need to set a password first.
        </Paragraph>
        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">New wallet</Paragraph>
          <Paragraph color="$color10" fontSize="$2">
            Generate a recovery phrase and start with a fresh vault.
          </Paragraph>
          <Button onPress={onCreate}>Create password</Button>
        </Card>
        <Button onPress={onImportMnemonic}>Import seed phrase</Button>
        <Button onPress={onImportPrivateKey}>Import private key</Button>
      </Card>
    </YStack>
  );
}
