import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BackupPage } from "@/ui/pages/backup/BackupPage";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/backup/$keySourceId")({
  component: BackupRoute,
});

function BackupRoute() {
  const { status } = useWallet();
  const { keySourceId } = Route.useParams();
  const navigate = Route.useNavigate();

  if (status === "uninitialized") return <Navigate to="/onboarding" replace />;

  return (
    <BackupPage
      key={keySourceId}
      keySourceId={keySourceId}
      onComplete={() => {
        void navigate({ to: "/onboarding", replace: true });
        window.close();
      }}
    />
  );
}
