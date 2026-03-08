export type ApprovalWindowTracker = {
  assign(input: { windowId: number; approvalId: string }): void;
  takeWindowApprovalIds(windowId: number): string[];
  deleteApproval(approvalId: string): void;
  clear(): void;
};

export const createApprovalWindowTracker = (): ApprovalWindowTracker => {
  const approvalIdsByWindowId = new Map<number, Set<string>>();
  const windowIdByApprovalId = new Map<string, number>();

  const deleteApproval = (approvalId: string) => {
    const windowId = windowIdByApprovalId.get(approvalId);
    if (windowId === undefined) return;

    windowIdByApprovalId.delete(approvalId);

    const approvalIds = approvalIdsByWindowId.get(windowId);
    if (!approvalIds) return;

    approvalIds.delete(approvalId);
    if (approvalIds.size === 0) {
      approvalIdsByWindowId.delete(windowId);
    }
  };

  return {
    assign({ windowId, approvalId }) {
      deleteApproval(approvalId);

      const approvalIds = approvalIdsByWindowId.get(windowId) ?? new Set<string>();
      approvalIds.add(approvalId);
      approvalIdsByWindowId.set(windowId, approvalIds);
      windowIdByApprovalId.set(approvalId, windowId);
    },
    takeWindowApprovalIds(windowId) {
      const approvalIds = approvalIdsByWindowId.get(windowId);
      if (!approvalIds) return [];

      approvalIdsByWindowId.delete(windowId);
      const ids = [...approvalIds];
      for (const approvalId of ids) {
        windowIdByApprovalId.delete(approvalId);
      }
      return ids;
    },
    deleteApproval,
    clear() {
      approvalIdsByWindowId.clear();
      windowIdByApprovalId.clear();
    },
  };
};
