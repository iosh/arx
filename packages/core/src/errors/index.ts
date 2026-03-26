export type { ArxReason } from "@arx/errors";
export { ArxError, ArxReasons, arxError, isArxError } from "@arx/errors";
export {
  createSurfaceErrorEncoder,
  type EncodedSurfaceExecutionResult,
  type SurfaceErrorContext,
  type SurfaceErrorEncoder,
} from "./surfaceErrorEncoder.js";
