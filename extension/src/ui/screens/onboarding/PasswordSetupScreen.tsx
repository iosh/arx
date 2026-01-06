import { LockKeyhole } from "lucide-react";
import { useMemo, useState } from "react";
import { Form, Paragraph, useTheme, YStack } from "tamagui";
import { Button, PasswordInput, Screen } from "@/ui/components";
import { getInitErrorMessage } from "@/ui/lib/errorUtils";

// we can use zxcvbn package to check password strength
type PasswordSetupScreenProps = {
  onSubmit: (password: string) => Promise<unknown>;
};

type PasswordStrength = {
  valid: boolean;
  message: string;
  hint?: string;
  color: string;
};

const MIN_PASSWORD_LENGTH = 8;
const RECOMMENDED_PASSWORD_LENGTH = 12;

const hasAscendingRun = (value: string, runLength: number): boolean => {
  if (runLength <= 1) return false;
  const lower = value.toLowerCase();
  for (let start = 0; start + runLength <= lower.length; start += 1) {
    let isRun = true;
    for (let index = start + 1; index < start + runLength; index += 1) {
      const prev = lower.charCodeAt(index - 1);
      const current = lower.charCodeAt(index);
      if (current !== prev + 1) {
        isRun = false;
        break;
      }
    }
    if (isRun) return true;
  }
  return false;
};

const getPasswordStrength = (value: string) => {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Must be at least ${MIN_PASSWORD_LENGTH} characters`,
      color: "$danger",
    } satisfies PasswordStrength;
  }

  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^a-zA-Z0-9]/.test(value);
  const charClassCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  const tooRepetitive = /(.)\1{3,}/.test(value);
  const hasSequence = hasAscendingRun(value, 4);

  let score = 0;
  if (value.length >= RECOMMENDED_PASSWORD_LENGTH) score += 1;
  if (value.length >= 16) score += 1;
  if (charClassCount >= 2) score += 1;
  if (charClassCount >= 3) score += 1;
  if (tooRepetitive) score -= 1;
  if (hasSequence) score -= 1;

  if (score <= 1) {
    return {
      valid: true,
      message: "Weak password",
      hint: `Use ${RECOMMENDED_PASSWORD_LENGTH}+ characters (a passphrase works well).`,
      color: "$yellow10",
    } satisfies PasswordStrength;
  }

  if (score <= 3) {
    return {
      valid: true,
      message: "Good password",
      color: "$accent",
    } satisfies PasswordStrength;
  }
  return {
    valid: true,
    message: "Strong password",
    color: "$success",
  } satisfies PasswordStrength;
};

export function PasswordSetupScreen({ onSubmit }: PasswordSetupScreenProps) {
  const theme = useTheme();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const confirmError =
    confirm.length > 0 && password.length > 0 && confirm !== password ? "Passwords do not match" : null;

  const passwordsMatch = strength.valid && confirmError === null && password === confirm;
  const canSubmit = passwordsMatch && !isSubmitting && password.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit(password);
    } catch (err) {
      setSubmitError(getInitErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padded={false} scroll={false}>
      <YStack flex={1} justifyContent="center" padding="$6" gap="$8" maxWidth={480} width="100%" alignSelf="center">
        <YStack alignItems="center" gap="$5">
          <YStack backgroundColor="$surface" padding="$5" borderRadius="$full" borderWidth={1} borderColor="$border">
            <LockKeyhole size={48} strokeWidth={1.5} color={theme.text?.get()} />
          </YStack>

          <YStack alignItems="center" gap="$2">
            <Paragraph textAlign="center" color="$mutedText" fontSize="$4">
              Protect your wallet with a strong password.
            </Paragraph>
          </YStack>
        </YStack>

        <Form onSubmit={handleSubmit} gap="$4">
          <YStack gap="$4">
            <PasswordInput
              label="New Password"
              placeholder="Enter at least 8 characters"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (submitError) setSubmitError(null);
              }}
              autoComplete="new-password"
              autoFocus
              disabled={isSubmitting}
              errorText={password.length > 0 && !strength.valid ? strength.message : undefined}
              helperText={
                password.length > 0 && strength.valid ? (
                  <YStack gap="$1">
                    <Paragraph color={strength.color as any} fontSize="$1">
                      {strength.message}
                    </Paragraph>
                    {strength.hint ? (
                      <Paragraph color="$mutedText" fontSize="$1">
                        {strength.hint}
                      </Paragraph>
                    ) : null}
                  </YStack>
                ) : undefined
              }
            />

            <PasswordInput
              label="Confirm Password"
              placeholder="Re-enter password"
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
                if (submitError) setSubmitError(null);
              }}
              autoComplete="new-password"
              disabled={isSubmitting}
              errorText={confirmError ?? undefined}
            />
          </YStack>

          {submitError ? (
            <Paragraph color="$danger" fontSize="$3" textAlign="center">
              {submitError}
            </Paragraph>
          ) : null}

          <Button
            variant="primary"
            size="$5"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={isSubmitting}
            fontWeight="600"
          >
            Create Password
          </Button>
        </Form>
      </YStack>
    </Screen>
  );
}
