import type { UiSnapshot } from "@arx/core/ui";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Form, H2, Paragraph, YStack } from "tamagui";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { Button, PasswordInput, Screen } from "../components";
import { getUnlockErrorMessage } from "../lib/errorUtils";
import { ROUTES } from "../lib/routes";

type UnlockScreenProps = {
  onSubmit: (password: string) => Promise<unknown>;
  attention?: UiSnapshot["attention"];
  approvalsCount?: number;
};

export const UnlockScreen = ({ onSubmit, attention, approvalsCount = 0 }: UnlockScreenProps) => {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attentionQueue = attention?.queue ?? [];
  const attentionCount = attention?.count ?? attentionQueue.length;
  const latestAttention = attentionQueue.length > 0 ? attentionQueue[attentionQueue.length - 1] : null;

  const formatOriginHost = (origin: string) => {
    try {
      return new URL(origin).host || origin;
    } catch {
      return origin;
    }
  };

  const getRequestLabel = (method: string) => {
    switch (method) {
      case "eth_requestAccounts":
      case "wallet_requestPermissions":
        return "connection request";
      case "personal_sign":
      case "eth_signTypedData_v4":
        return "signature request";
      case "eth_sendTransaction":
        return "transaction request";
      default:
        return "request";
    }
  };

  const originHost = latestAttention ? formatOriginHost(latestAttention.origin) : null;
  const requestLabel = latestAttention ? getRequestLabel(latestAttention.method) : null;
  const handleSubmit = async () => {
    if (!password || isSubmitting) return;
    setSubmitting(true);
    setError(null);
    const pwd = password;
    setPassword("");
    try {
      await onSubmit(pwd);

      let hasApprovals = approvalsCount > 0;
      try {
        const latestSnapshot = await uiClient.waitForSnapshot({
          timeoutMs: 2000,
          predicate: (snapshot) => snapshot.session.isUnlocked,
        });
        hasApprovals = latestSnapshot.approvals.length > 0;
      } catch {
        // Best-effort: navigation should not fail unlock UX if snapshot fetch fails.
      }

      if (hasApprovals) {
        router.navigate({ to: ROUTES.APPROVALS, replace: true });
      } else {
        router.navigate({ to: ROUTES.HOME, replace: true });
      }
    } catch (err) {
      setError(getUnlockErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Screen scroll={false}>
      <Form onSubmit={handleSubmit} alignItems="stretch" padding="$4" gap="$4">
        <YStack gap="$2">
          <H2>Unlock Wallet</H2>
          <Paragraph color="$mutedText">Enter your password to access accounts.</Paragraph>
        </YStack>

        {latestAttention ? (
          <Card padded bordered backgroundColor="$surface" borderColor="$accent" gap="$2">
            <Paragraph fontWeight="600" color="$accent">
              Action required
            </Paragraph>
            <Paragraph color="$mutedText" fontSize="$2">
              Pending {requestLabel} from {originHost}. ({attentionCount} total) Unlock, then return to the dApp and
              retry.
            </Paragraph>
            <YStack gap="$1">
              <Paragraph fontSize="$2">Origin: {originHost}</Paragraph>
              <Paragraph fontSize="$2">Method: {latestAttention.method}</Paragraph>
              <Paragraph fontSize="$2">Chain: {latestAttention.chainRef ?? "-"}</Paragraph>
              <Paragraph fontSize="$2">Namespace: {latestAttention.namespace ?? "-"}</Paragraph>
            </YStack>
          </Card>
        ) : null}

        <PasswordInput
          label="Password"
          revealMode="press"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          autoFocus
          disabled={isSubmitting}
          errorText={error ?? undefined}
        />

        <Button variant="primary" onPress={handleSubmit} disabled={!password || isSubmitting} loading={isSubmitting}>
          Unlock
        </Button>
      </Form>
    </Screen>
  );
};
