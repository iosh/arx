import { ArxBaseError, type ErrorCause } from "../error.js";

type ApprovalErrorInput = ErrorCause & {
  message?: string;
};

export class ApprovalRejectedError extends ArxBaseError {
  static readonly code = "approval.rejected";

  constructor(input: ApprovalErrorInput = {}) {
    super(input.message ?? "Approval rejected.", {
      code: ApprovalRejectedError.code,
      cause: input.cause,
    });
  }
}

export class ApprovalTimeoutError extends ArxBaseError {
  static readonly code = "approval.timeout";

  constructor(input: ApprovalErrorInput = {}) {
    super(input.message ?? "Approval timed out.", {
      code: ApprovalTimeoutError.code,
      cause: input.cause,
    });
  }
}

export class ApprovalCancelledError extends ArxBaseError {
  static readonly code = "approval.cancelled";

  constructor(input: ApprovalErrorInput = {}) {
    super(input.message ?? "Approval cancelled.", {
      code: ApprovalCancelledError.code,
      cause: input.cause,
    });
  }
}

export class ApprovalUserDismissedError extends ArxBaseError {
  static readonly code = "approval.user_dismissed";

  constructor(input: ApprovalErrorInput = {}) {
    super(input.message ?? "Approval dismissed by user.", {
      code: ApprovalUserDismissedError.code,
      cause: input.cause,
    });
  }
}

export class ApprovalSupersededError extends ArxBaseError {
  static readonly code = "approval.superseded";

  constructor(input: ApprovalErrorInput = {}) {
    super(input.message ?? "Approval superseded.", {
      code: ApprovalSupersededError.code,
      cause: input.cause,
    });
  }
}
