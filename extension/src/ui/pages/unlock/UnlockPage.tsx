import { useTranslation } from "react-i18next";
import { UnlockForm } from "@/ui/components/unlock-form/UnlockForm";

export function UnlockPage({ focusPassword }: { focusPassword: boolean }) {
  const { t } = useTranslation("wallet");

  return (
    <main className="flex h-full flex-col items-center gap-10 px-6 pt-35 pb-6 font-sans">
      <title>{`${t("unlock")} · ARX`}</title>
      <h1 className="text-3xl leading-tight font-bold text-brand">ARX</h1>
      <UnlockForm focusPassword={focusPassword} />
    </main>
  );
}
