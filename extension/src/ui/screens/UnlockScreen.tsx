import type { UiSnapshot } from "@arx/core/ui";
import { useState } from "react";
import { Card, Form, H2, Input, Paragraph, YStack } from "tamagui";
import { Button } from "../components";
import { getUnlockErrorMessage } from "../lib/errorUtils";

type UnlockScreenProps = {
  onSubmit: (password: string) => Promise<unknown>;
  attention?: UiSnapshot["attention"];
};

export const UnlockScreen = ({ onSubmit, attention }: UnlockScreenProps) => {
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attentionQueue = attention?.queue ?? [];
  const attentionCount = attention?.count ?? attentionQueue.length;
  const latestAttention = attentionQueue.length > 0 ? attentionQueue[attentionQueue.length - 1] : null;

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
        <Paragraph color="$color10">Enter your password to access accounts.</Paragraph>
      </YStack>

      {latestAttention ? (
        <Card padded bordered backgroundColor="$orange2" borderColor="$orange7" gap="$2">
          <Paragraph fontWeight="600" color="$orange10">
            Action required
          </Paragraph>
          <Paragraph color="$color10" fontSize="$2">
            {attentionCount} pending request{attentionCount === 1 ? "" : "s"}. Unlock, then return to the dApp and
            retry.
          </Paragraph>
          <YStack gap="$1">
            <Paragraph fontSize="$2">Origin: {latestAttention.origin}</Paragraph>
            <Paragraph fontSize="$2">Method: {latestAttention.method}</Paragraph>
            <Paragraph fontSize="$2">Chain: {latestAttention.chainRef ?? "-"}</Paragraph>
            <Paragraph fontSize="$2">Namespace: {latestAttention.namespace ?? "-"}</Paragraph>
          </YStack>
        </Card>
      ) : null}

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
