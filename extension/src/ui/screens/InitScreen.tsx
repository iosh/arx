import { useMemo, useState } from "react";
import { Form, H2, Paragraph, YStack } from "tamagui";
import { Button, PasswordInput, Screen } from "../components";
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const confirmError =
    confirm.length > 0 && password.length > 0 && confirm !== password ? "Passwords do not match" : null;

  const passwordsMatch = strength.valid && confirmError === null && password === confirm;

  const handleSubmit = async () => {
    if (!passwordsMatch || isSubmitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const pwd = password;
    setPassword("");
    setConfirm("");

    try {
      await onSubmit(pwd);
    } catch (err) {
      setSubmitError(getInitErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padded={false}>
      <Form onSubmit={handleSubmit} alignItems="stretch" padding="$4" gap="$4">
        <YStack gap="$2">
          <H2>Create Password</H2>
          <Paragraph color="$mutedText">
            Choose a strong password. It will be required every time you unlock the wallet.
          </Paragraph>
        </YStack>

        <PasswordInput
          label="Password"
          placeholder="Enter password"
          value={password}
          onChangeText={setPassword}
          autoFocus
          disabled={isSubmitting}
          errorText={password.length > 0 && !strength.valid ? strength.message : undefined}
          helperText={password.length > 0 && strength.valid ? strength.message : undefined}
        />

        <PasswordInput
          label="Confirm Password"
          placeholder="Re-enter password"
          value={confirm}
          onChangeText={setConfirm}
          disabled={isSubmitting}
          errorText={confirmError ?? undefined}
        />

        {submitError ? (
          <Paragraph color="$danger" fontSize="$2">
            {submitError}
          </Paragraph>
        ) : null}

        <Button
          variant="primary"
          onPress={handleSubmit}
          disabled={!passwordsMatch || isSubmitting}
          loading={isSubmitting}
        >
          Create Password
        </Button>
      </Form>
    </Screen>
  );
};
