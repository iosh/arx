import { Card, Paragraph, ScrollView, XStack, YStack } from "tamagui";
import { Button } from "@/ui/components";

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
  return (
    <YStack flex={1} padding="$4" gap="$3">
      <Paragraph fontSize="$6" fontWeight="600">
        Backup your recovery phrase
      </Paragraph>
      <Paragraph color="$color10">
        Write these words down in order and keep them somewhere safe. Anyone with these words can access your funds.
      </Paragraph>

      <Card padded bordered minHeight={160}>
        {isLoading ? (
          <Paragraph>Generating phrase…</Paragraph>
        ) : words.length === 0 ? (
          <Paragraph color="$color10">Tap “Regenerate” to fetch a new phrase.</Paragraph>
        ) : (
          <ScrollView>
            <XStack flexWrap="wrap" gap="$2">
              {words.map((word, index) => (
                <Card key={`${word}`} padded bordered width="30%" minWidth={90}>
                  <Paragraph color="$color10" fontSize="$2">
                    {index + 1}.
                  </Paragraph>
                  <Paragraph fontWeight="600">{word}</Paragraph>
                </Card>
              ))}
            </XStack>
          </ScrollView>
        )}
      </Card>

      {error ? (
        <Paragraph color="$red10" fontSize="$2">
          {error}
        </Paragraph>
      ) : null}

      <Button onPress={onRefresh} loading={isLoading}>
        Regenerate phrase
      </Button>
      <Button onPress={onContinue} disabled={isLoading || words.length === 0}>
        Verify phrase
      </Button>
      <Button onPress={onSkip} disabled={isLoading || words.length === 0} color="$orange10">
        Skip verification (mark as not backed up)
      </Button>
    </YStack>
  );
}
