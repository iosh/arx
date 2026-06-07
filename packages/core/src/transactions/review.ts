export type Eip155TransactionReviewDetails = {
  namespace: "eip155";
  kind: "native_transfer" | "contract_interaction" | "contract_deployment";
  from: string;
  to: string | null;
  value: string;
  data: string | null;
  nonce: string | null;
  gasLimit: string | null;
  fees: {
    gasPrice: string | null;
    maxFeePerGas: string | null;
    maxPriorityFeePerGas: string | null;
  };
};

export type TransactionReviewDetails = Eip155TransactionReviewDetails;
