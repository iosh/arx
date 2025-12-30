import { useState } from "react";
import { Card, Input, Paragraph } from "tamagui";
import { Button } from "@/ui/components";

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
      <Input
        placeholder="0x..."
        value={privateKey}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isLoading}
        onChangeText={setPrivateKey}
      />
      <Input placeholder="Alias (optional)" value={alias} editable={!isLoading} onChangeText={setAlias} />

      {error ? (
        <Paragraph color="$red10" fontSize="$2">
          {error}
        </Paragraph>
      ) : null}

      <Button onPress={handleSubmit} loading={isLoading}>
        Import private key
      </Button>
    </Card>
  );
}
