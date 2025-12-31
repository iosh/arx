import { useState } from "react";
import { Card, Paragraph } from "tamagui";
import { Button, TextField } from "@/ui/components";

type ImportPrivateKeyScreenProps = {
  isLoading: boolean;
  error: string | null;
  onSubmit: (privateKey: string, alias?: string) => void;
};

export function ImportPrivateKeyScreen({ isLoading, error, onSubmit }: ImportPrivateKeyScreenProps) {
  const [privateKey, setPrivateKey] = useState("");
  const [alias, setAlias] = useState("");

  const handleSubmit = () => {
    onSubmit(privateKey, alias.trim() || undefined);
  };

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Private key</Paragraph>

      <TextField
        label="Private key"
        placeholder="0x..."
        value={privateKey}
        autoCapitalize="none"
        autoCorrect={false}
        disabled={isLoading}
        onChangeText={setPrivateKey}
      />

      <TextField
        label="Alias (optional)"
        placeholder="Alias"
        value={alias}
        disabled={isLoading}
        onChangeText={setAlias}
      />

      {error ? (
        <Paragraph color="$danger" fontSize="$2">
          {error}
        </Paragraph>
      ) : null}

      <Button variant="primary" onPress={handleSubmit} loading={isLoading}>
        Import private key
      </Button>
    </Card>
  );
}
