import type { ApprovalDetail } from "@arx/core/ui";
import { Card, Paragraph, XStack, YStack } from "tamagui";

type SendTransactionApproval = Extract<ApprovalDetail, { kind: "sendTransaction" }>;

export function SendTransactionPayload({ approval }: { approval: SendTransactionApproval }) {
  const review = approval.review.namespaceReview;
  const summary = review?.namespace === "eip155" ? review.summary : null;
  const execution = review?.namespace === "eip155" ? review.execution : null;

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Send Transaction</Paragraph>
      <YStack gap="$1">
        <DetailRow label="From" value={summary?.from ?? ""} mono />
        <DetailRow label="To" value={summary?.to ?? "Contract Creation"} mono />
        {summary?.value && <DetailRow label="Value" value={summary.value} />}
        {execution?.gas && <DetailRow label="Gas Limit" value={execution.gas} />}
        {summary?.data && (
          <YStack marginTop="$2">
            <Paragraph fontSize="$2" color="$color10">
              Data:
            </Paragraph>
            <Paragraph fontFamily="$mono" fontSize="$1" numberOfLines={3}>
              {summary.data}
            </Paragraph>
          </YStack>
        )}
      </YStack>
      {approval.review.reviewState.status === "preparing" ? (
        <Paragraph color="$color10" fontSize="$2">
          Preparing review…
        </Paragraph>
      ) : null}
      {approval.review.reviewState.status === "failed" && approval.review.prepareFailure ? (
        <Paragraph color="$red10" fontSize="$2">
          {approval.review.prepareFailure.message}
        </Paragraph>
      ) : null}
      {approval.review.reviewNotices.length > 0 && (
        <YStack marginTop="$2" gap="$1">
          {approval.review.reviewNotices.map((w) => (
            <Paragraph key={`${w.code}:${w.message}`} color="$orange10" fontSize="$2">
              ⚠ {w.message}
            </Paragraph>
          ))}
        </YStack>
      )}
      {approval.review.approvalBlocker ? (
        <Paragraph color="$red10" fontSize="$2">
          ✕ {approval.review.approvalBlocker.message}
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
