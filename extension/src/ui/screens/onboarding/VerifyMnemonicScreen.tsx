import { useState } from "react";
import { Card, Input, Paragraph, YStack } from "tamagui";
import { Button, Screen } from "@/ui/components";

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
      <Button onPress={onBack} disabled={pending}>
        Back
      </Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Verify recovery phrase
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          Enter the requested words to confirm you saved them correctly.
        </Paragraph>

        {quizIndexes.map((index) => (
          <YStack key={index} gap="$1">
            <Paragraph>Word #{index + 1}</Paragraph>
            <Input
              value={answers[index] ?? ""}
              onChangeText={(value) => handleChange(index, value)}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </YStack>
        ))}

        {error ? (
          <Paragraph color="$red10" fontSize="$2">
            {error}
          </Paragraph>
        ) : null}

        <Button onPress={handleSubmit} loading={pending}>
          Confirm mnemonic
        </Button>
      </Card>
    </Screen>
  );
}
