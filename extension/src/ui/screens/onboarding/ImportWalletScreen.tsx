import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { Form, H2, Paragraph, TextArea, useTheme, YStack } from "tamagui";
import { Button, Screen, TextField } from "@/ui/components";

type ImportWalletScreenProps = {
  isLoading: boolean;
  error: string | null;
  onSubmit: (value: string, alias?: string) => void;
};

export function ImportWalletScreen({ isLoading, error, onSubmit }: ImportWalletScreenProps) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [alias, setAlias] = useState("");
  const handleSubmit = () => {
    onSubmit(value, alias.trim() || undefined);
  };

  return (
    <Screen padded={false} scroll={false}>
      <YStack flex={1} justifyContent="center" padding="$6" gap="$8" maxWidth={480} width="100%" alignSelf="center">
        <YStack alignItems="center" gap="$5">
          <YStack backgroundColor="$surface" padding="$5" borderRadius="$full" borderWidth={1} borderColor="$border">
            <ArrowDownToLine size={48} strokeWidth={1.5} color={theme.text?.get()} />
          </YStack>

          <YStack alignItems="center" gap="$2">
            <H2 textAlign="center" size="$8" fontWeight="800">
              Import Wallet
            </H2>
            <Paragraph textAlign="center" color="$mutedText" fontSize="$4" lineHeight="$5">
              Enter your recovery phrase or private key to restore your wallet.
            </Paragraph>
          </YStack>
        </YStack>

        <Form onSubmit={handleSubmit} gap="$4">
          <YStack gap="$2">
            <Paragraph fontWeight="600" fontSize="$3" color="$text">
              Recovery Phrase or Private Key
            </Paragraph>
            <TextArea
              value={value}
              placeholder={"e.g. word1 word2 ... word12\nor 0x..."}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              onChangeText={setValue}
              minHeight={120}
              borderWidth={1}
              borderRadius="$md"
              backgroundColor="$surface"
              borderColor={error ? "$danger" : "$border"}
              focusStyle={{ borderColor: error ? "$danger" : "$accent" }}
              color="$text"
              placeholderTextColor="$mutedText"
              fontSize="$3"
              padding="$3"
            />
          </YStack>

          <TextField
            label="Wallet Alias (Optional)"
            value={alias}
            disabled={isLoading}
            onChangeText={setAlias}
            placeholder="e.g. Main Wallet"
          />

          {error ? (
            <Paragraph color="$danger" fontSize="$3" textAlign="center">
              {error}
            </Paragraph>
          ) : null}

          <Form.Trigger asChild>
            <Button variant="primary" size="$5" loading={isLoading} fontWeight="600" marginTop="$2">
              Import Wallet
            </Button>
          </Form.Trigger>
        </Form>
      </YStack>
    </Screen>
  );
}
