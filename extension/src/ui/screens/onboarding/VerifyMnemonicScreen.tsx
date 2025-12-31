import { useState } from "react";
import { Card, Paragraph, YStack } from "tamagui";
import { Button, Screen, TextField } from "@/ui/components";

type VerifyMnemonicScreenProps = {
  quizIndexes: number[];
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (answers: Record<number, string>) => void;
};

export function VerifyMnemonicScreen({ quizIndexes, pending, error, onBack, onSubmit }: VerifyMnemonicScreenProps) {
  const [answers, setAnswers] = useState<Record<number, string>>(
    Object.fromEntries(quizIndexes.map((index) => [index, ""])),
  );

  const handleChange = (index: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  const handleSubmit = () => {
    onSubmit(answers);
  };

  return (
    <Screen scroll={false} flex={1} padding="$4" gap="$3">
      <Button variant="ghost" onPress={onBack} disabled={pending}>
        Back
      </Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Verify recovery phrase
        </Paragraph>
        <Paragraph color="$mutedText" fontSize="$2">
          Enter the requested words to confirm you saved them correctly.
        </Paragraph>

        {quizIndexes.map((index) => (
          <YStack key={index} gap="$1">
            <TextField
              label={`Word #${index + 1}`}
              value={answers[index] ?? ""}
              onChangeText={(value) => handleChange(index, value)}
              autoCapitalize="none"
              autoCorrect={false}
              disabled={pending}
            />
          </YStack>
        ))}

        {error ? (
          <Paragraph color="$danger" fontSize="$2">
            {error}
          </Paragraph>
        ) : null}

        <Button variant="primary" onPress={handleSubmit} loading={pending}>
          Confirm mnemonic
        </Button>
      </Card>
    </Screen>
  );
}
