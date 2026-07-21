import { ArxBaseError } from "../errors.js";

export class ApprovalRejectedError extends ArxBaseError {
  static readonly code = "approval.rejected";

  constructor() {
    super("Approval rejected.", {
      code: ApprovalRejectedError.code,
    });
  }
}

export class ApprovalTimeoutError extends ArxBaseError {
  static readonly code = "approval.timeout";

  constructor() {
    super("Approval timed out.", {
      code: ApprovalTimeoutError.code,
    });
  }
}

export class ApprovalCancelledError extends ArxBaseError {
  static readonly code = "approval.cancelled";

  constructor() {
    super("Approval cancelled.", {
      code: ApprovalCancelledError.code,
    });
  }
}

export class ApprovalNotFoundError extends ArxBaseError {
  static readonly code = "approval.not_found";

  constructor(approvalId: string) {
    super(`Approval "${approvalId}" was not found.`, {
      code: ApprovalNotFoundError.code,
      details: { approvalId },
    });
  }
}
