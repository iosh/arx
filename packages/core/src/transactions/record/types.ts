import type { TransactionRecordView } from "./index.js";

export type TransactionRecordReader = {
  getRecordView(id: string): TransactionRecordView | undefined;
  getOrLoadRecordView(id: string): Promise<TransactionRecordView | null>;
  onChanged(handler: (transactionIds: string[]) => void): () => void;
};
