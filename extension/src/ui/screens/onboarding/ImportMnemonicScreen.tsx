import { useState } from "react";
import { Card, Paragraph, TextArea } from "tamagui";
import { Button, TextField } from "@/ui/components";

type ImportMnemonicScreenProps = {
  isLoading: boolean;
  error: string | null;
  onSubmit: (phrase: string, alias?: string) => void;
};

export function ImportMnemonicScreen({ isLoading, error, onSubmit }: ImportMnemonicScreenProps) {
  const [phrase, setPhrase] = useState("");
  const [alias, setAlias] = useState("");

  const handleSubmit = () => {
    onSubmit(phrase, alias.trim() || undefined);
  };

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Seed phrase</Paragraph>

      <TextArea
        value={phrase}
        placeholder="Enter words separated by spaces"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isLoading}
        onChangeText={setPhrase}
      />

      <TextField
        label="Alias (optional)"
        value={alias}
        disabled={isLoading}
        onChangeText={setAlias}
        placeholder="Alias"
      />

      {error ? (
        <Paragraph color="$danger" fontSize="$2">
          {error}
        </Paragraph>
      ) : null}

      <Button variant="primary" onPress={handleSubmit} loading={isLoading}>
        Import mnemonic
      </Button>
    </Card>
  );
}
