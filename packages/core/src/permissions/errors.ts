import { ArxBaseError } from "../errors.js";

export type PermissionErrorInput = {
  message?: string;
};

export class PermissionNotConnectedError extends ArxBaseError {
  static readonly code = "global.permission.not_connected";

  constructor(input: PermissionErrorInput = {}) {
    super(input.message ?? "Origin is not connected.", {
      code: PermissionNotConnectedError.code,
    });
  }
}

export class PermissionDeniedError extends ArxBaseError {
  static readonly code = "global.permission.denied";

  constructor(input: PermissionErrorInput = {}) {
    super(input.message ?? "Permission denied.", {
      code: PermissionDeniedError.code,
    });
  }
}
