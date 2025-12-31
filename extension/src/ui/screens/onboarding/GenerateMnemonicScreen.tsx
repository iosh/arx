import { Card, Paragraph, XStack } from "tamagui";
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
  return (
    <Screen scroll={false}>
      <Paragraph fontSize="$6" fontWeight="600">
        Backup your recovery phrase
      </Paragraph>
      <Paragraph color="$mutedText">
        Write these words down in order and keep them somewhere safe. Anyone with these words can access your funds.
      </Paragraph>

      <Card padded bordered minHeight={160}>
        {isLoading ? (
          <Paragraph>Generating phrase…</Paragraph>
        ) : words.length === 0 ? (
          <Paragraph color="$mutedText">Tap “Regenerate” to fetch a new phrase.</Paragraph>
        ) : (
          <XStack flexWrap="wrap" gap="$2">
            {words.map((word, index) => (
              <Card key={`${word}`} padded bordered width="30%" minWidth={90}>
                <Paragraph color="$mutedText" fontSize="$2">
                  {index + 1}.
                </Paragraph>
                <Paragraph fontWeight="600">{word}</Paragraph>
              </Card>
            ))}
          </XStack>
        )}
      </Card>

      {error ? (
        <Paragraph color="$danger" fontSize="$2">
          {error}
        </Paragraph>
      ) : null}

      <Button onPress={onRefresh} loading={isLoading}>
        Regenerate phrase
      </Button>
      <Button variant="primary" onPress={onContinue} disabled={isLoading || words.length === 0}>
        Verify phrase
      </Button>
      <Button variant="danger" onPress={onSkip} disabled={isLoading || words.length === 0}>
        Skip verification (mark as not backed up)
      </Button>
    </Screen>
  );
}
