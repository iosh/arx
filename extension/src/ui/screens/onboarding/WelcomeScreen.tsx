import { ArrowDownToLine, KeyRound, Plus, WalletMinimal } from "lucide-react";
import { H2, Paragraph, Separator, useTheme, XStack, YStack } from "tamagui";
import { Button, Screen } from "@/ui/components";

type WelcomeScreenProps = {
  onCreate: () => void;
  onImportMnemonic: () => void;
  onImportPrivateKey: () => void;
};

export function WelcomeScreen({ onCreate, onImportMnemonic, onImportPrivateKey }: WelcomeScreenProps) {
  const theme = useTheme();

  return (
    <Screen padded={false} scroll={false}>
      <YStack flex={1} justifyContent="center" padding="$6" gap="$8" maxWidth={480} width="100%" alignSelf="center">
        {/* Header */}
        <YStack alignItems="center" gap="$5">
          <YStack
            backgroundColor="$surface"
            padding="$5"
            borderRadius="$full"
            borderWidth={1}
            borderColor="$border"
            animation="fast"
            hoverStyle={{ scale: 1.05 }}
          >
            <WalletMinimal size={48} strokeWidth={1.5} color={theme.text?.get()} />
          </YStack>

          <YStack alignItems="center" gap="$2" maxWidth={320}>
            <H2 textAlign="center" size="$8" fontWeight="800">
              Welcome to ARX
            </H2>
            <Paragraph textAlign="center" color="$mutedText" fontSize="$4" lineHeight="$5">
              Your gateway to the decentralized web. Secure, simple, and extensible.
            </Paragraph>
          </YStack>
        </YStack>

        {/* Actions */}
        <YStack gap="$4" width="100%">
          <Button variant="primary" size="$5" icon={<Plus size={20} />} onPress={onCreate} fontWeight="600">
            Create a new Wallet
          </Button>

          <XStack alignItems="center" gap="$3" opacity={0.5}>
            <Separator />
            <Paragraph fontSize="$2" fontWeight="600">
              OR IMPORT
            </Paragraph>
            <Separator />
          </XStack>

          <YStack gap="$3">
            <Button variant="secondary" size="$4" icon={<ArrowDownToLine size={18} />} onPress={onImportMnemonic}>
              Import Recovery Phrase
            </Button>
            <Button variant="secondary" size="$4" icon={<KeyRound size={18} />} onPress={onImportPrivateKey}>
              Import Private Key
            </Button>
          </YStack>
        </YStack>
      </YStack>
    </Screen>
  );
}
