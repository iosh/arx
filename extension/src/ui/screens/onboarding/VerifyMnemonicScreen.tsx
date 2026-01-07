import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Form, H2, Paragraph, useTheme, YStack } from "tamagui";
import { Button, Screen, TextField } from "@/ui/components";

type VerifyMnemonicScreenProps = {
  quizIndexes: number[];
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (answers: Record<number, string>) => void;
};

export function VerifyMnemonicScreen({ quizIndexes, pending, error, onBack, onSubmit }: VerifyMnemonicScreenProps) {
  const theme = useTheme();
  const [answers, setAnswers] = useState<Record<number, string>>(
    Object.fromEntries(quizIndexes.map((index) => [index, ""])),
  );

  const handleChange = (index: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  const allFilled = quizIndexes.every((index) => answers[index]?.trim().length > 0);

  const handleSubmit = () => {
    if (pending || !allFilled) return;
    onSubmit(answers);
  };

  return (
    <Screen padded={false} scroll={false}>
      <YStack flex={1} justifyContent="center" padding="$6" gap="$8" maxWidth={480} width="100%" alignSelf="center">
        <YStack alignItems="center" gap="$5">
          <YStack backgroundColor="$surface" padding="$5" borderRadius="$full" borderWidth={1} borderColor="$border">
            <ShieldCheck size={48} strokeWidth={1.5} color={theme.text?.get()} />
          </YStack>

          <YStack alignItems="center" gap="$2">
            <H2 textAlign="center" size="$8" fontWeight="800">
              Verify Phrase
            </H2>
            <Paragraph textAlign="center" color="$mutedText" fontSize="$4" lineHeight="$5">
              Confirm you've saved your recovery phrase by entering the requested words below.
            </Paragraph>
          </YStack>
        </YStack>

        <Form onSubmit={handleSubmit} gap="$4">
          <YStack gap="$4">
            {quizIndexes.map((index) => (
              <TextField
                key={index}
                label={`Word #${index + 1}`}
                placeholder={`Enter word #${index + 1}`}
                value={answers[index] ?? ""}
                onChangeText={(value) => handleChange(index, value)}
                autoCapitalize="none"
                autoCorrect={false}
                disabled={pending}
              />
            ))}
          </YStack>

          {error ? (
            <Paragraph color="$danger" fontSize="$3" textAlign="center">
              {error}
            </Paragraph>
          ) : null}

          <YStack gap="$3" marginTop="$2">
            <Form.Trigger asChild>
              <Button variant="primary" size="$5" loading={pending} disabled={!allFilled || pending} fontWeight="600">
                Verify & Complete
              </Button>
            </Form.Trigger>
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onPress={onBack} disabled={pending} size="$3">
              Back to Phrase
            </Button>
          </YStack>
        </Form>
      </YStack>
    </Screen>
  );
}
