import { z } from "zod";
import { ChainSnapshotSchema, UiAccountMetaSchema, UiKeyringMetaSchema, UiSnapshotSchema } from "./schemas.js";

export type UiMethodDefinition = {
  paramsSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  effects?: {
    broadcastSnapshot?: boolean;
    persistVaultMeta?: boolean;
    holdBroadcast?: boolean;
  };
};

const defineMethod = <P extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  paramsSchema: P,
  resultSchema: R,
  effects?: UiMethodDefinition["effects"],
) => ({
  paramsSchema,
  resultSchema,
  ...(effects ? { effects } : {}),
});

const UnlockReasonSchema = z.enum(["manual", "timeout", "blur", "suspend", "reload"]);

const UnlockStateSchema = z.strictObject({
  isUnlocked: z.boolean(),
  timeoutMs: z.number().int().nonnegative(),
  nextAutoLockAt: z.number().int().nullable(),
  lastUnlockedAt: z.number().int().nullable(),
});

const VaultCiphertextSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  algorithm: z.literal("pbkdf2-sha256"),
  salt: z.string().min(1),
  iterations: z.number().int().positive(),
  iv: z.string().min(1),
  cipher: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

const VaultInitResultSchema = z.strictObject({
  ciphertext: VaultCiphertextSchema,
});

const SetAutoLockDurationResultSchema = z.strictObject({
  autoLockDurationMs: z.number().int().nonnegative(),
  nextAutoLockAt: z.number().int().nullable(),
});

const OpenOnboardingTabResultSchema = z.strictObject({
  activationPath: z.enum(["focus", "create", "debounced"]),
  tabId: z.number().int().optional(),
});

const PermissionRequestDescriptorSchema = z.strictObject({
  capability: z.string().min(1),
  scope: z.string().min(1),
  chains: z.array(z.string().min(1)),
});

const PermissionApprovalResultSchema = z.strictObject({
  granted: z.array(PermissionRequestDescriptorSchema),
});

const TransactionWarningSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  data: z.unknown().optional(),
});

const TransactionErrorSchema = z.strictObject({
  name: z.string().min(1),
  message: z.string().min(1),
  code: z.number().optional(),
  data: z.unknown().optional(),
});

const TransactionRequestSchema = z.strictObject({
  namespace: z.string().min(1),
  caip2: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

const TransactionMetaSchema = z.strictObject({
  id: z.string().min(1),
  namespace: z.string().min(1),
  caip2: z.string().min(1),
  origin: z.string().min(1),
  from: z.string().min(1).nullable(),
  request: TransactionRequestSchema,
  status: z.enum(["pending", "approved", "signed", "broadcast", "confirmed", "failed", "replaced"]),
  hash: z.string().nullable(),
  receipt: z.record(z.string(), z.unknown()).nullable(),
  error: TransactionErrorSchema.nullable(),
  userRejected: z.boolean(),
  warnings: z.array(TransactionWarningSchema),
  issues: z.array(TransactionWarningSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const ApprovalApproveResultSchema = z.strictObject({
  id: z.string().min(1),
  result: z.union([
    TransactionMetaSchema,
    z.array(z.string().min(1)),
    z.string().min(1),
    PermissionApprovalResultSchema,
    z.null(),
  ]),
});

const ApprovalRejectResultSchema = z.strictObject({
  id: z.string().min(1),
});

const KeyringAccountSchema = z.strictObject({
  address: z.string().min(1),
  derivationPath: z.string().nullable(),
  derivationIndex: z.number().int().nullable(),
  source: z.enum(["derived", "imported"]),
});

const GenerateMnemonicResultSchema = z.strictObject({
  words: z.array(z.string().min(1)).min(12).max(24),
});

const ExportMnemonicResultSchema = z.strictObject({
  words: z.array(z.string().min(1)).min(12).max(24),
});

const ExportPrivateKeyResultSchema = z.strictObject({
  // uiBridge currently returns hex WITHOUT 0x prefix.
  privateKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

const ConfirmMnemonicResultSchema = z.strictObject({
  keyringId: z.uuid(),
  address: z.string().min(1),
});
const ImportPrivateKeyResultSchema = z.strictObject({
  keyringId: z.uuid(),
  account: KeyringAccountSchema,
});

export const uiMethods = {
  // --- snapshot ---
  "ui.snapshot.get": defineMethod(z.undefined(), UiSnapshotSchema.strict()),

  // --- vault ---
  "ui.vault.init": defineMethod(z.strictObject({ password: z.string().min(1) }), VaultInitResultSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.vault.initAndUnlock": defineMethod(z.strictObject({ password: z.string().min(1) }), UnlockStateSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  // --- session ---
  "ui.session.unlock": defineMethod(z.strictObject({ password: z.string().min(1) }), UnlockStateSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  "ui.session.lock": defineMethod(
    z.strictObject({ reason: UnlockReasonSchema.optional() }).optional(),
    UnlockStateSchema,
    { broadcastSnapshot: true, persistVaultMeta: true },
  ),

  "ui.session.resetAutoLockTimer": defineMethod(z.undefined(), UnlockStateSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.session.setAutoLockDuration": defineMethod(
    z.strictObject({ durationMs: z.number().finite() }),
    SetAutoLockDurationResultSchema,
    { broadcastSnapshot: true, persistVaultMeta: true },
  ),

  // --- onboarding ---
  "ui.onboarding.openTab": defineMethod(z.strictObject({ reason: z.string().min(1) }), OpenOnboardingTabResultSchema),

  // --- accounts ---
  "ui.accounts.switchActive": defineMethod(
    z.strictObject({
      chainRef: z.string().min(1),
      address: z.string().nullable().optional(),
    }),
    z.string().nullable(),
    { broadcastSnapshot: true },
  ),

  // --- networks ---
  "ui.networks.switchActive": defineMethod(
    z.strictObject({ chainRef: z.string().min(1) }),
    ChainSnapshotSchema.strict(),
    { broadcastSnapshot: true },
  ),

  // --- approvals ---
  "ui.approvals.approve": defineMethod(z.strictObject({ id: z.string().min(1) }), ApprovalApproveResultSchema, {
    broadcastSnapshot: true,
  }),

  "ui.approvals.reject": defineMethod(
    z.strictObject({ id: z.string().min(1), reason: z.string().min(1).optional() }),
    ApprovalRejectResultSchema,
    { broadcastSnapshot: true },
  ),

  // --- keyrings ---
  "ui.keyrings.generateMnemonic": defineMethod(
    z.strictObject({ wordCount: z.union([z.literal(12), z.literal(24)]).optional() }).optional(),
    GenerateMnemonicResultSchema,
  ),

  "ui.keyrings.confirmNewMnemonic": defineMethod(
    z.strictObject({
      words: z.array(z.string().min(1)).min(12).max(24),
      alias: z.string().min(1).optional(),
      skipBackup: z.boolean().optional(),
      namespace: z.string().min(1).optional(),
    }),
    ConfirmMnemonicResultSchema,
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.importMnemonic": defineMethod(
    z.strictObject({
      words: z.array(z.string().min(1)).min(12).max(24),
      alias: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
    }),
    ConfirmMnemonicResultSchema,
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.importPrivateKey": defineMethod(
    z.strictObject({
      privateKey: z.string().min(1),
      alias: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
    }),
    ImportPrivateKeyResultSchema,
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.deriveAccount": defineMethod(z.strictObject({ keyringId: z.uuid() }), KeyringAccountSchema, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.list": defineMethod(z.undefined(), z.array(UiKeyringMetaSchema.strict())),

  "ui.keyrings.getAccountsByKeyring": defineMethod(
    z.strictObject({ keyringId: z.uuid(), includeHidden: z.boolean().optional() }),
    z.array(UiAccountMetaSchema.strict()),
  ),

  "ui.keyrings.renameKeyring": defineMethod(
    z.strictObject({ keyringId: z.uuid(), alias: z.string().min(1) }),
    z.null(),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.renameAccount": defineMethod(
    z.strictObject({ address: z.string().min(1), alias: z.string().min(1) }),
    z.null(),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.markBackedUp": defineMethod(z.strictObject({ keyringId: z.uuid() }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.hideHdAccount": defineMethod(z.strictObject({ address: z.string().min(1) }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.unhideHdAccount": defineMethod(z.strictObject({ address: z.string().min(1) }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.removePrivateKeyKeyring": defineMethod(z.strictObject({ keyringId: z.uuid() }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.exportMnemonic": defineMethod(
    z.strictObject({ keyringId: z.uuid(), password: z.string().min(1) }),
    ExportMnemonicResultSchema,
  ),

  "ui.keyrings.exportPrivateKey": defineMethod(
    z.strictObject({ address: z.string().min(1), password: z.string().min(1) }),
    ExportPrivateKeyResultSchema,
  ),
} as const satisfies Record<string, UiMethodDefinition>;
