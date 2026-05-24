import type { ApprovalDetail } from "@arx/core/ui";
import { Card, Paragraph, XStack, YStack } from "tamagui";

type SendTransactionApproval = Extract<ApprovalDetail, { kind: "sendTransaction" }>;

export function SendTransactionPayload({ approval }: { approval: SendTransactionApproval }) {
  const details = approval.review.details;
  const prepare = approval.review.prepare;
  const toLabel = details ? (details.kind === "contract_deployment" ? "Contract Creation" : (details.to ?? "")) : "";

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Send Transaction</Paragraph>
      <YStack gap="$1">
        <DetailRow label="From" value={details?.from ?? ""} mono />
        <DetailRow label="To" value={toLabel} mono />
        {details ? <DetailRow label="Value" value={details.value} /> : null}
        {details?.gasLimit ? <DetailRow label="Gas Limit" value={details.gasLimit} /> : null}
        {details?.fees.gasPrice ? <DetailRow label="Gas Price" value={details.fees.gasPrice} /> : null}
        {details?.fees.maxFeePerGas ? <DetailRow label="Max Fee" value={details.fees.maxFeePerGas} /> : null}
        {details?.fees.maxPriorityFeePerGas ? (
          <DetailRow label="Priority Fee" value={details.fees.maxPriorityFeePerGas} />
        ) : null}
        {details?.data && (
          <YStack marginTop="$2">
            <Paragraph fontSize="$2" color="$color10">
              Data:
            </Paragraph>
            <Paragraph fontFamily="$mono" fontSize="$1" numberOfLines={3}>
              {details.data}
            </Paragraph>
          </YStack>
        )}
      </YStack>
      {prepare.state === "preparing" ? (
        <Paragraph color="$color10" fontSize="$2">
          Checking gas and balance...
        </Paragraph>
      ) : null}
      {prepare.state === "failed" ? (
        <Paragraph color="$red10" fontSize="$2">
          {prepare.error.message}
        </Paragraph>
      ) : null}
      {prepare.state === "blocked" ? (
        <Paragraph color="$red10" fontSize="$2">
          {prepare.blocker.message}
        </Paragraph>
      ) : null}
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <XStack justifyContent="space-between" gap="$2">
      <Paragraph color="$color10" fontSize="$2">
        {label}:
      </Paragraph>
      <Paragraph fontSize="$2" fontFamily={mono ? "$mono" : undefined} numberOfLines={1} flex={1} textAlign="right">
        {value}
      </Paragraph>
    </XStack>
  );
}
