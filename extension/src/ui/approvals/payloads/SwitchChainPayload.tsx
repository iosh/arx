import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type SwitchChainApproval = Extract<ApprovalSummary, { type: "switchChain" }>;

export function SwitchChainPayload({ approval }: { approval: SwitchChainApproval }) {
  const { payload } = approval;
  const title = payload.displayName ?? payload.chainRef;

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Switch Network</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        This site wants to switch the active network in your wallet.
      </Paragraph>

      <YStack gap="$1" marginTop="$2">
        <Paragraph fontSize="$2">Target Network:</Paragraph>
        <Paragraph fontFamily="$mono" fontSize="$2">
          {title}
        </Paragraph>
      </YStack>

      {payload.chainId ? (
        <YStack gap="$1">
          <Paragraph fontSize="$2">Chain ID:</Paragraph>
          <Paragraph fontFamily="$mono" fontSize="$2">
            {payload.chainId}
          </Paragraph>
        </YStack>
      ) : null}
    </Card>
  );
}
