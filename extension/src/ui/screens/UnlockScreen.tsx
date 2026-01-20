import { useRouter } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useState } from "react";
import { Form, H3, Paragraph, useTheme, YStack } from "tamagui";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { Button, PasswordInput, Screen } from "../components";
import { getUnlockErrorMessage } from "../lib/errorUtils";
import { ROUTES } from "../lib/routes";

type UnlockScreenProps = {
  onSubmit: (password: string) => Promise<unknown>;
  approvalsCount?: number;
};

export const UnlockScreen = ({ onSubmit, approvalsCount = 0 }: UnlockScreenProps) => {
  const router = useRouter();
  const theme = useTheme();
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!password || isSubmitting) return;
    setSubmitting(true);
    setError(null);
    const pwd = password;

    try {
      await onSubmit(pwd);
      setPassword("");

      // If approvals are already queued, go there immediately.
      if (approvalsCount > 0) {
        router.navigate({ to: ROUTES.APPROVALS, replace: true });
        return;
      }

      // Otherwise, give the UI a brief window to receive any approval that may be created
      // right after unlock (reduces races before Orchestrator owns all navigation).
      try {
        await uiClient.waitForSnapshot({
          timeoutMs: 750,
          predicate: (snapshot) => snapshot.session.isUnlocked && snapshot.approvals.length > 0,
        });
        router.navigate({ to: ROUTES.APPROVALS, replace: true });
        return;
      } catch {
        // Best-effort: falling back to HOME should not fail unlock UX.
      }

      router.navigate({ to: ROUTES.HOME, replace: true });
    } catch (err) {
      setError(getUnlockErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll={false}>
      <YStack flex={1} justifyContent="center" paddingVertical="$8">
        <YStack width="100%" maxWidth={400} alignSelf="center" gap="$6">
          <YStack alignItems="center" gap="$4">
            <YStack
              backgroundColor="$surface"
              padding="$4"
              borderRadius={100}
              alignItems="center"
              justifyContent="center"
              animation="fast"
            >
              <Lock size={32} color={theme.text.get()} strokeWidth={2} />
            </YStack>

            <YStack alignItems="center" gap="$2">
              <H3 textAlign="center" fontWeight="700">
                Welcome Back
              </H3>
              <Paragraph color="$mutedText" textAlign="center" size="$3">
                Enter your password to unlock
              </Paragraph>
            </YStack>
          </YStack>

          <Form onSubmit={handleSubmit} gap="$4" alignItems="stretch">
            <YStack gap="$2">
              <PasswordInput
                revealMode="press"
                placeholder="Password"
                aria-label="Password"
                autoComplete="current-password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (error) setError(null);
                }}
                autoFocus
                disabled={isSubmitting}
                errorText={error ?? undefined}
                size="$4"
              />
            </YStack>

            <Button
              variant="primary"
              onPress={handleSubmit}
              disabled={!password || isSubmitting}
              loading={isSubmitting}
              size="$4"
            >
              Unlock
            </Button>
          </Form>
        </YStack>
      </YStack>
    </Screen>
  );
};
