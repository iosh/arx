import { ArxBaseError } from "../errors.js";

export class ApprovalRejectedError extends ArxBaseError {
  static readonly code = "approval.rejected";

  constructor(message = "Approval rejected.") {
    super(message, {
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

export class ApprovalUserDismissedError extends ArxBaseError {
  static readonly code = "approval.user_dismissed";

  constructor() {
    super("Approval dismissed by user.", {
      code: ApprovalUserDismissedError.code,
    });
  }
}

export class ApprovalSupersededError extends ArxBaseError {
  static readonly code = "approval.superseded";

  constructor() {
    super("Approval superseded.", {
      code: ApprovalSupersededError.code,
    });
  }
}

export class ApprovalRequesterRequiredError extends ArxBaseError {
  static readonly code = "approval.requester_required";

  constructor() {
    super("Approval requester is required.", {
      code: ApprovalRequesterRequiredError.code,
    });
  }
}

export class ApprovalOriginMismatchError extends ArxBaseError {
  static readonly code = "approval.origin_mismatch";

  constructor(input: { approvalId: string; origin: string; requesterOrigin: string }) {
    super("Approval origin does not match requester origin.", {
      code: ApprovalOriginMismatchError.code,
      details: {
        approvalId: input.approvalId,
        origin: input.origin,
        requesterOrigin: input.requesterOrigin,
      },
    });
  }
}

export class DuplicateApprovalError extends ArxBaseError {
  static readonly code = "approval.duplicate_id";

  constructor(approvalId: string) {
    super(`Duplicate approval id "${approvalId}".`, {
      code: DuplicateApprovalError.code,
      details: { approvalId },
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

export class UnsupportedApprovalKindError extends ArxBaseError {
  static readonly code = "approval.unsupported_kind";

  constructor(approvalKind: string) {
    super(`Unsupported approval kind "${approvalKind}".`, {
      code: UnsupportedApprovalKindError.code,
      details: { approvalKind },
    });
  }
}

export class UnexpectedApprovalCancellationError extends ArxBaseError {
  static readonly code = "approval.unexpected_cancellation";

  constructor(approvalId: string) {
    super(`Unexpected approval cancellation for approved request "${approvalId}".`, {
      code: UnexpectedApprovalCancellationError.code,
      details: { approvalId },
    });
  }
}
