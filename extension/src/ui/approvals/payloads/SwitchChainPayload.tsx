import type { ApprovalDetail } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type SwitchChainApproval = Extract<ApprovalDetail, { kind: "switchChain" }>;

export function SwitchChainPayload({ approval }: { approval: SwitchChainApproval }) {
  const { request } = approval;
  const title = request.displayName ?? request.chainRef;

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

      {request.chainId ? (
        <YStack gap="$1">
          <Paragraph fontSize="$2">Chain ID:</Paragraph>
          <Paragraph fontFamily="$mono" fontSize="$2">
            {request.chainId}
          </Paragraph>
        </YStack>
      ) : null}
    </Card>
  );
}
