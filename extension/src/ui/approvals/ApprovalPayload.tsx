import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph } from "tamagui";
import { AddChainPayload } from "./payloads/AddChainPayload";
import { RequestAccountsPayload } from "./payloads/RequestAccountsPayload";
import { RequestPermissionsPayload } from "./payloads/RequestPermissionsPayload";
import { SendTransactionPayload } from "./payloads/SendTransactionPayload";
import { SignMessagePayload } from "./payloads/SignMessagePayload";
import { SignTypedDataPayload } from "./payloads/SignTypedDataPayload";
import { SwitchChainPayload } from "./payloads/SwitchChainPayload";

const assertNever = (value: never): never => {
  throw new Error(`Unhandled approval type: ${JSON.stringify(value)}`);
};

export function ApprovalPayload({ approval }: { approval: ApprovalSummary }) {
  switch (approval.type) {
    case "requestAccounts":
      return <RequestAccountsPayload approval={approval} />;
    case "signMessage":
      return <SignMessagePayload approval={approval} />;
    case "signTypedData":
      return <SignTypedDataPayload approval={approval} />;
    case "sendTransaction":
      return <SendTransactionPayload approval={approval} />;
    case "requestPermissions":
      return <RequestPermissionsPayload approval={approval} />;
    case "switchChain":
      return <SwitchChainPayload approval={approval} />;
    case "addChain":
      return <AddChainPayload approval={approval} />;
    case "unsupported":
      return (
        <Card padded bordered>
          <Paragraph color="$color10">Unsupported approval type</Paragraph>
          <Paragraph color="$color10" fontSize="$2">
            {approval.payload.rawType}
          </Paragraph>
        </Card>
      );
  }

  return assertNever(approval);
}
