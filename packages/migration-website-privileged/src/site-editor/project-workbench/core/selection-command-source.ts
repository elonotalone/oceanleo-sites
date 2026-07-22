import type {
  SelectionCommand,
  SelectionContext,
  SelectionControl,
  SelectionControlValue,
} from "@oceanleo/ui/shell";
import { requestId } from "./contracts";

export const PREVIEW_TOOLS = [
  "pages",
  "sections",
  "components",
  "assets",
  "layers",
  "styles",
  "navigation",
  "forms",
] as const;

export type PreviewTool = (typeof PREVIEW_TOOLS)[number];

export interface ContextCommandDescriptor {
  id: string;
  label: string;
  controlId: string | null;
  value?: SelectionControlValue;
  danger?: boolean;
  local: "selection-command" | "copy-stable-id";
}

const CONTEXT_CONTROL_ORDER = [
  "duplicate",
  "move-up",
  "move-down",
  "delete",
] as const;

const TOOL_CONTROL_IDS: Record<Exclude<PreviewTool, "pages">, Set<string>> = {
  sections: new Set(["duplicate", "delete", "move-up", "move-down"]),
  components: new Set([
    "text",
    "duplicate",
    "delete",
    "display",
    "responsive-breakpoint",
  ]),
  assets: new Set(["src", "alt", "poster", "insert-image"]),
  layers: new Set([
    "move-up",
    "move-down",
    "layout-x",
    "layout-y",
    "layout-w",
    "layout-h",
    "layout-order",
    "display",
  ]),
  styles: new Set([
    "color",
    "background",
    "font-family",
    "font-size",
    "font-weight",
    "text-align",
    "border",
    "border-radius",
    "border-color",
    "border-width",
    "border-style",
    "padding",
    "margin",
    "opacity",
    "display",
    "gap",
    "responsive-breakpoint",
  ]),
  navigation: new Set(["href"]),
  forms: new Set([
    "name",
    "type",
    "placeholder",
    "required",
    "action",
    "method",
  ]),
};

export function controlsForPreviewTool(
  tool: PreviewTool,
  context: SelectionContext | null,
): SelectionControl[] {
  if (!context || tool === "pages") return [];
  const accepted = TOOL_CONTROL_IDS[tool];
  return context.controls.filter((control) => accepted.has(control.id));
}

/**
 * The floating context bar and right-click menu both consume this exact array.
 * A renderer may present it differently, but command ids and values cannot
 * drift into separate mutation implementations.
 */
export function buildContextCommandSource(
  context: SelectionContext | null,
): ContextCommandDescriptor[] {
  if (!context) return [];
  const byId = new Map(context.controls.map((control) => [control.id, control]));
  const commands: ContextCommandDescriptor[] =
    CONTEXT_CONTROL_ORDER.flatMap((controlId) => {
    const control = byId.get(controlId);
    if (!control || control.disabled) return [];
    return [
      {
        id: `selection:${control.id}`,
        label: control.label,
        controlId: control.id,
        danger: control.danger || control.tone === "danger",
        local: "selection-command",
      } satisfies ContextCommandDescriptor,
    ];
    });
  commands.push({
    id: "local:copy-stable-id",
    label: "Copy stable ID",
    controlId: null,
    local: "copy-stable-id",
  });
  return commands;
}

export function selectionCommand(
  context: SelectionContext,
  controlId: string,
  value?: SelectionControlValue,
): SelectionCommand {
  return {
    requestId: requestId("website-selection"),
    selectionId: context.id,
    selectionRevision: context.revision,
    ...(context.epoch !== undefined
      ? { selectionEpoch: context.epoch }
      : {}),
    controlId,
    ...(value !== undefined ? { value } : {}),
  };
}
