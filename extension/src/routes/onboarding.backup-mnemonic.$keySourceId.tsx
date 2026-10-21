import { createFileRoute } from "@tanstack/react-router";
import { BackupMnemonicPage } from "@/ui/pages/onboarding/BackupMnemonicPage";

export const Route = createFileRoute("/onboarding/backup-mnemonic/$keySourceId")({
  component: BackupMnemonicRoute,
  remountDeps: ({ params }) => params.keySourceId,
});

function BackupMnemonicRoute() {
  const { keySourceId } = Route.useParams();
  return <BackupMnemonicPage keySourceId={keySourceId} />;
}
