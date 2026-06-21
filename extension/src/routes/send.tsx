import { eip155Request } from "@arx/core/transactions/eip155";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LoadingScreen } from "@/ui/components";
import { useUiCurrentChainAccounts } from "@/ui/hooks/useUiCurrentChainAccounts";
import { requireSetupComplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { SendScreen } from "@/ui/screens/SendScreen";
import { useSendApprovalAction } from "@/ui/send/useSendApprovalAction";

export const Route = createFileRoute("/send")({
  beforeLoad: requireSetupComplete,
  component: SendPage,
});

function SendPage() {
  const router = useRouter();
  const accountsQuery = useUiCurrentChainAccounts();
  const { pending, errorMessage, submitSendApproval } = useSendApprovalAction();

  if (accountsQuery.isLoading || !accountsQuery.data) {
    return <LoadingScreen />;
  }

  const { chain, accounts } = accountsQuery.data;

  return (
    <SendScreen
      chain={chain}
      accounts={accounts}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={() => router.navigate({ to: ROUTES.HOME })}
      onSubmit={(params) => {
        void submitSendApproval({
          request: eip155Request({
            to: params.to,
            value: params.value,
          }),
        });
      }}
    />
  );
}
