import { KeyRound, RefreshCw } from "lucide-react";
import { H2, Paragraph, Spinner, useTheme, XStack, YStack } from "tamagui";
import { Button, Screen } from "@/ui/components";

type GenerateMnemonicScreenProps = {
  words: string[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

export function GenerateMnemonicScreen({
  words,
  isLoading,
  error,
  onRefresh,
  onContinue,
  onSkip,
}: GenerateMnemonicScreenProps) {
  const theme = useTheme();

  return (
    <Screen padded={false} scroll={false}>
      <YStack flex={1} justifyContent="center" padding="$6" gap="$8" maxWidth={480} width="100%" alignSelf="center">
        {/* Header */}
        <YStack alignItems="center" gap="$5">
          <YStack backgroundColor="$surface" padding="$5" borderRadius="$full" borderWidth={1} borderColor="$border">
            <KeyRound size={48} strokeWidth={1.5} color={theme.text?.get()} />
          </YStack>

          <YStack alignItems="center" gap="$2">
            <H2 textAlign="center" size="$8" fontWeight="800">
              Recovery Phrase
            </H2>
            <Paragraph textAlign="center" color="$mutedText" fontSize="$4" lineHeight="$5">
              Write down these words in the correct order. Keep them safe—they are the only way to recover your funds.
            </Paragraph>
          </YStack>
        </YStack>

        {/* Phrase Display */}
        <YStack
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
          borderRadius="$md"
          padding="$4"
          minHeight={180}
          justifyContent="center"
        >
          {isLoading ? (
            <YStack alignItems="center" gap="$3">
              <Spinner size="large" color="$accent" />
              <Paragraph color="$mutedText">Generating phrase...</Paragraph>
            </YStack>
          ) : words.length === 0 ? (
            <YStack alignItems="center" gap="$3">
              <Paragraph color="$mutedText" textAlign="center">
                Tap "Regenerate" to create a new phrase.
              </Paragraph>
            </YStack>
          ) : (
            <XStack flexWrap="wrap" gap="$3" justifyContent="center">
              {words.map((word, index) => (
                <XStack
                  key={`${index}-${word}`}
                  backgroundColor="$bg"
                  borderWidth={1}
                  borderColor="$border"
                  borderRadius="$sm"
                  paddingHorizontal="$3"
                  paddingVertical="$2"
                  alignItems="center"
                  gap="$2"
                  minWidth={100}
                >
                  <Paragraph color="$mutedText" fontSize="$2" fontWeight="500">
                    {index + 1}.
                  </Paragraph>
                  <Paragraph color="$text" fontWeight="600" fontSize="$3">
                    {word}
                  </Paragraph>
                </XStack>
              ))}
            </XStack>
          )}
        </YStack>

        {error ? (
          <Paragraph color="$danger" fontSize="$3" textAlign="center">
            {error}
          </Paragraph>
        ) : null}

        {/* Actions */}
        <YStack gap="$4">
          <Button
            variant="primary"
            size="$5"
            onPress={onContinue}
            disabled={isLoading || words.length === 0}
            fontWeight="600"
          >
            Verify Phrase
          </Button>

          <XStack gap="$3">
            <Button
              flex={1}
              variant="secondary"
              icon={<RefreshCw size={16} />}
              onPress={onRefresh}
              loading={isLoading}
              disabled={isLoading}
            >
              Regenerate
            </Button>
            {/* 
                We can add a copy to clipboard button here later if desired, 
                but typically we want to encourage writing it down.
            */}
          </XStack>

          <Button
            variant="ghost"
            size="$3"
            onPress={onSkip}
            disabled={isLoading || words.length === 0}
            color="$danger"
            opacity={0.8}
            hoverStyle={{ opacity: 1, backgroundColor: "$red2" }}
          >
            I'll do this later (Not Recommended)
          </Button>
        </YStack>
      </YStack>
    </Screen>
  );
}
