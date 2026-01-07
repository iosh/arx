import { Check, Rocket } from "lucide-react";
import { H2, Paragraph, useTheme, YStack } from "tamagui";
import { Button, Screen } from "@/ui/components";

type SetupCompleteScreenProps = {
  onOpenWallet: () => void;
};

export function SetupCompleteScreen({ onOpenWallet }: SetupCompleteScreenProps) {
  const theme = useTheme();

  return (
    <Screen padded={false} scroll={false}>
      <YStack flex={1} justifyContent="center" padding="$6" gap="$8" maxWidth={480} width="100%" alignSelf="center">
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
            <Rocket size={48} strokeWidth={1.5} color={theme.text?.get()} />
          </YStack>

          <YStack alignItems="center" gap="$2">
            <H2 textAlign="center" size="$8" fontWeight="800">
              All Set!
            </H2>
            <Paragraph textAlign="center" color="$mutedText" fontSize="$4" lineHeight="$5">
              Your wallet is ready to use. You can now close this window and start using the extension.
            </Paragraph>
          </YStack>
        </YStack>

        <YStack gap="$4" width="100%">
          <Button variant="primary" size="$5" icon={<Check size={20} />} onPress={onOpenWallet} fontWeight="600">
            Close
          </Button>
        </YStack>
      </YStack>
    </Screen>
  );
}
