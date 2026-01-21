import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

type ApprovalSnoozeContextValue = {
  snoozedHeadId: string | null;
  snoozeHeadId: (id: string | null) => void;
};

const ApprovalSnoozeContext = createContext<ApprovalSnoozeContextValue | null>(null);

export function ApprovalSnoozeProvider({ children }: { children: ReactNode }) {
  const [snoozedHeadId, setSnoozedHeadId] = useState<string | null>(null);

  const value = useMemo<ApprovalSnoozeContextValue>(
    () => ({
      snoozedHeadId,
      snoozeHeadId: setSnoozedHeadId,
    }),
    [snoozedHeadId],
  );

  return <ApprovalSnoozeContext.Provider value={value}>{children}</ApprovalSnoozeContext.Provider>;
}

export function useApprovalSnooze(): ApprovalSnoozeContextValue {
  const ctx = useContext(ApprovalSnoozeContext);
  if (!ctx) {
    throw new Error("useApprovalSnooze must be used within ApprovalSnoozeProvider");
  }
  return ctx;
}
