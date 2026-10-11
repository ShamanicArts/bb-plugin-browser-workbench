import { z } from "zod";

export const browserGraphicsSettingsSchema = z.object({ profile: z.enum(["default", "webgl-only", "webgpu-only"]), experimentalWebPlatform: z.boolean() }).strict();
export type BrowserGraphicsSettings = z.infer<typeof browserGraphicsSettingsSchema>;
export const browserGraphicsStateSchema = z.object({ active: browserGraphicsSettingsSchema, requested: browserGraphicsSettingsSchema, restartRequired: z.boolean(), warning: z.string().nullable() });
export const browserPermissionSchema = z.enum([
  "microphone", "camera", "midi", "midiSysex", "geolocation", "notifications",
  "clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock", "speaker-selection",
]);
export type BrowserPermission = z.infer<typeof browserPermissionSchema>;
export const browserPermissionDecisionSchema = z.enum(["default", "allow", "block"]);
export const browserWorkbenchActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot") }).strict(),
  z.object({ kind: z.literal("set-graphics"), settings: browserGraphicsSettingsSchema }).strict(),
  z.object({ kind: z.literal("set-permission"), origin: z.string().max(2048), permission: browserPermissionSchema, decision: browserPermissionDecisionSchema }).strict(),
  z.object({ kind: z.literal("reset-permissions"), origin: z.string().max(2048) }).strict(),
  z.object({ kind: z.literal("clear-console") }).strict(),
  z.object({ kind: z.literal("open-devtools") }).strict(),
]);
export type BrowserWorkbenchAction = z.infer<typeof browserWorkbenchActionSchema>;
export const browserWorkbenchSnapshotSchema = z.object({
  origin: z.string().max(2048),
  graphics: browserGraphicsStateSchema.nullable(),
  permissions: z.array(z.object({ permission: browserPermissionSchema, decision: browserPermissionDecisionSchema, allowed: z.boolean() })).max(20),
  console: z.array(z.object({ sequence: z.number().int(), time: z.number(), level: z.enum(["info", "warning", "error", "debug"]), message: z.string().max(2048), source: z.string().max(2048), line: z.number() })).max(200),
  denied: z.array(z.object({ permission: z.string().max(100), origin: z.string().max(2048), time: z.number() })).max(50),
  scope: z.literal("tab-origin"),
});
export type BrowserWorkbenchSnapshot = z.infer<typeof browserWorkbenchSnapshotSchema>;
