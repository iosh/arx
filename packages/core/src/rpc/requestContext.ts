export type RequestContext = {
  transport: "provider" | "ui";
  portId: string;
  sessionId: string;
  requestId: string;
  origin: string;
};
