import type { Hex } from "ox/Hex";
import type { AccountAddress } from "../../accounts/types.js";

export type Eip155PersonalMessage =
  | Readonly<{ format: "hex"; value: Hex }>
  | Readonly<{ format: "utf8"; value: string }>;

export type Eip155TypedDataField = Readonly<{
  name: string;
  type: string;
}>;

export type Eip155TypedDataValue =
  | null
  | boolean
  | number
  | string
  | readonly Eip155TypedDataValue[]
  | Readonly<{ [key: string]: Eip155TypedDataValue }>;

export type Eip155TypedData = Readonly<{
  types: Readonly<Record<string, readonly Eip155TypedDataField[]>>;
  primaryType: string;
  domain: Readonly<Record<string, Eip155TypedDataValue>>;
  message: Readonly<Record<string, Eip155TypedDataValue>>;
}>;

type Eip155SignRequestBase = Readonly<{
  account: AccountAddress;
}>;

export type Eip155SignRequest =
  | (Eip155SignRequestBase &
      Readonly<{
        type: "personalMessage";
        message: Eip155PersonalMessage;
      }>)
  | (Eip155SignRequestBase &
      Readonly<{
        type: "typedData";
        typedData: Eip155TypedData;
      }>);
