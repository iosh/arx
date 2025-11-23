import { useState } from "react";
import { Form, H2, Input, Paragraph, YStack } from "tamagui";
import { Button } from "../components";
import { getUnlockErrorMessage } from "../lib/errorUtils";

type UnlockScreenProps = {
  onSubmit: (password: string) => Promise<unknown>;
};

export const UnlockScreen = ({ onSubmit }: UnlockScreenProps) => {
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!password || isSubmitting) return;
    setSubmitting(true);
    setError(null);
    const pwd = password;
    setPassword("");
    try {
      await onSubmit(pwd);
    } catch (err) {
      setError(getUnlockErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit} alignItems="stretch" padding="$4" gap="$4">
      <YStack gap="$2">
        <H2>Unlock Wallet</H2>
        <Paragraph color="$colorMuted">Enter your password to access accounts.</Paragraph>
      </YStack>

      <Input secureTextEntry placeholder="Password" value={password} onChangeText={setPassword} autoFocus />

      {error ? (
        <Paragraph color="$red10" fontSize="$2">
          {error}
        </Paragraph>
      ) : null}

      <Button onPress={handleSubmit} disabled={!password || isSubmitting} loading={isSubmitting}>
        Unlock
      </Button>
    </Form>
  );
};
