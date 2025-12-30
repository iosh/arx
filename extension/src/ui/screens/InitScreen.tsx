import { useMemo, useState } from "react";
import { Form, H2, Input, Paragraph, YStack } from "tamagui";
import { Button, Screen } from "../components";
import { getInitErrorMessage } from "../lib/errorUtils";

type InitScreenProps = {
  onSubmit: (password: string) => Promise<unknown>;
};

const getPasswordStrength = (value: string) => {
  if (value.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters" };
  }
  if (value.length < 12) {
    return { valid: true, message: "Weak password. Consider using 12+ characters." };
  }
  return { valid: true, message: "Strong password" };
};

export const InitScreen = ({ onSubmit }: InitScreenProps) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = strength.valid && password === confirm;

  const handleSubmit = async () => {
    if (!passwordsMatch || isSubmitting) return;
    setSubmitting(true);
    setError(null);
    const pwd = password;
    setPassword("");
    setConfirm("");
    try {
      await onSubmit(pwd);
    } catch (err) {
      setError(getInitErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll={false}>
      <Form onSubmit={handleSubmit} alignItems="stretch" padding="$4" gap="$4">
        <YStack gap="$2">
          <H2>Create Password</H2>
          <Paragraph color="$color10">
            Choose a strong password. It will be required every time you unlock the wallet.
          </Paragraph>
        </YStack>

        <YStack gap="$1">
          <Paragraph>Password</Paragraph>
          <Input secureTextEntry placeholder="Enter password" value={password} onChangeText={setPassword} autoFocus />
          {password.length > 0 ? (
            <Paragraph color={strength.valid ? "$color10" : "$red10"} fontSize="$2">
              {strength.message}
            </Paragraph>
          ) : null}
        </YStack>

        <YStack gap="$1">
          <Paragraph>Confirm Password</Paragraph>
          <Input secureTextEntry placeholder="Re-enter password" value={confirm} onChangeText={setConfirm} />
        </YStack>

        {error ? (
          <Paragraph color="$red10" fontSize="$2">
            {error}
          </Paragraph>
        ) : null}

        <Button onPress={handleSubmit} disabled={!passwordsMatch || isSubmitting} loading={isSubmitting}>
          Create Password
        </Button>
      </Form>
    </Screen>
  );
};
