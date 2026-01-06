import { useEffect, useState } from "react";
import { Card, Paragraph, TextArea, YStack } from "tamagui";
import { Button, TextField } from "@/ui/components";

type ImportWalletScreenProps = {
  isLoading: boolean;
  error: string | null;
  onSubmit: (value: string, alias?: string) => void;
};

export function ImportWalletScreen({ isLoading, error, onSubmit }: ImportWalletScreenProps) {
  const [value, setValue] = useState("");
  const [alias, setAlias] = useState("");

  useEffect(() => {
    setValue("");
    setAlias("");
  }, []);

  const handleSubmit = () => {
    onSubmit(value, alias.trim() || undefined);
  };

  return (
    <Card padded bordered gap="$4">
      <YStack gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Import wallet
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          Paste a recovery phrase (seed phrase) or a private key — we'll detect the type automatically.
        </Paragraph>
      </YStack>

      <YStack gap="$2">
        <Paragraph fontWeight="600">Recovery phrase or private key</Paragraph>
        <TextArea
          value={value}
          placeholder={"e.g. word1 word2 ... word12\nor 0x..."}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
          onChangeText={setValue}
          minHeight={100}
        />
      </YStack>

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
        Import
      </Button>
    </Card>
  );
}
