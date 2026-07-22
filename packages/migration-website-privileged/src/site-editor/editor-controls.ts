import type {
  SelectionContext,
  SelectionControl,
} from "@oceanleo/ui/shell";
import type { SelectionControlIcon } from "@oceanleo/ui/shell/selection-context";
import {
  isStableEditorId,
  type WebsiteEditorBreakpoint,
} from "./editor-runtime";

type WebsiteSelectionControl = SelectionControl & {
  slot?: "compact" | "inspector" | "stage" | "context-menu";
  inspectorGroup?: string;
  inspectorLabel?: string;
  inspectorIcon?: SelectionControlIcon;
};

export type WebsiteSelectionContext = SelectionContext & {
  revision: string | number;
  controls: WebsiteSelectionControl[];
};

export interface DomSelection {
  id: string;
  revision: string | number;
  epoch?: string | number;
  breakpoint: WebsiteEditorBreakpoint;
  selector: string;
  tag: string;
  label: string;
  text: string;
  textEditable: boolean;
  layoutEditable?: boolean;
  structuralEditable?: boolean;
  outerHTML: string;
  attributes: {
    src: string;
    alt: string;
    href: string;
    poster: string;
  };
  styles: {
    color: string;
    background: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    textAlign: string;
    borderRadius: number;
    padding: number;
    margin: number;
    opacity: number;
    display: string;
    gap: number;
    borderColor: string;
    borderWidth: number;
    borderStyle?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    order: number;
  };
  anchor: { x: number; y: number; width: number; height: number };
}

function breakpointControl(
  selection: DomSelection,
): WebsiteSelectionControl {
  return inspectorControl(
    {
      id: "responsive-breakpoint",
      kind: "select",
      label: "断点",
      icon: "position",
      value: selection.breakpoint,
      options: [
        { value: "base", label: "基础（全部）" },
        { value: "mobile", label: "手机 ≤639" },
        { value: "tablet", label: "平板 640–1023" },
        { value: "desktop", label: "桌面 ≥1024" },
      ],
    },
    "website-responsive",
    "响应式",
    "position",
  );
}

function inspectorControl(
  control: SelectionControl,
  group: string,
  label: string,
  icon: SelectionControlIcon,
): WebsiteSelectionControl {
  return {
    ...control,
    slot: "inspector",
    inspectorGroup: group,
    inspectorLabel: label,
    inspectorIcon: icon,
  };
}

function styleControls(selection: DomSelection): WebsiteSelectionControl[] {
  return [
    inspectorControl(
      {
        id: "font-family",
        kind: "select",
        label: "字体",
        icon: "font",
        value: selection.styles.fontFamily,
        options: [
          { value: "sans", label: "无衬线" },
          { value: "serif", label: "衬线" },
          { value: "mono", label: "等宽" },
        ],
      },
      "website-typography",
      "文字",
      "font",
    ),
    inspectorControl(
      {
        id: "font-size",
        kind: "number",
        label: "字号",
        icon: "text",
        value: selection.styles.fontSize,
        min: 8,
        max: 240,
        suffix: "px",
      },
      "website-typography",
      "文字",
      "font",
    ),
    inspectorControl(
      {
        id: "font-weight",
        kind: "select",
        label: "字重",
        icon: "bold",
        value: selection.styles.fontWeight,
        options: [
          { value: "400", label: "常规" },
          { value: "500", label: "中等" },
          { value: "600", label: "半粗" },
          { value: "700", label: "粗体" },
          { value: "800", label: "特粗" },
        ],
      },
      "website-typography",
      "文字",
      "font",
    ),
    inspectorControl(
      {
        id: "text-align",
        kind: "select",
        label: "对齐",
        icon: "align-left",
        value: selection.styles.textAlign,
        options: [
          { value: "left", label: "左" },
          { value: "center", label: "中" },
          { value: "right", label: "右" },
          { value: "justify", label: "两端" },
        ],
      },
      "website-typography",
      "文字",
      "font",
    ),
    inspectorControl(
    {
      id: "color",
      kind: "color",
      label: "文字色",
      icon: "text",
      value: selection.styles.color,
    },
      "website-colors",
      "颜色",
      "background",
    ),
    inspectorControl(
    {
      id: "background",
      kind: "color",
      label: "背景",
      icon: "background",
      value: selection.styles.background,
    },
      "website-colors",
      "颜色",
      "background",
    ),
    inspectorControl(
    {
      id: "border-radius",
      kind: "range",
      label: "圆角",
      icon: "border",
      value: selection.styles.borderRadius,
      min: 0,
      max: 120,
      suffix: "px",
    },
      "website-border",
      "边框",
      "border",
    ),
    inspectorControl(
    {
      id: "border-color",
      kind: "color",
      label: "边框色",
      icon: "border",
      value: selection.styles.borderColor,
    },
      "website-border",
      "边框",
      "border",
    ),
    inspectorControl(
    {
      id: "border-width",
      kind: "range",
      label: "边框宽度",
      icon: "border",
      value: selection.styles.borderWidth,
      min: 0,
      max: 32,
      suffix: "px",
    },
      "website-border",
      "边框",
      "border",
    ),
    inspectorControl(
    {
      id: "border-style",
      kind: "select",
      label: "边框样式",
      icon: "border",
      value:
        selection.styles.borderStyle ||
        (selection.styles.borderWidth > 0 ? "solid" : "none"),
      options: [
        { value: "none", label: "无" },
        { value: "solid", label: "实线" },
        { value: "dashed", label: "虚线" },
        { value: "dotted", label: "点线" },
        { value: "double", label: "双线" },
      ],
    },
      "website-border",
      "边框",
      "border",
    ),
    inspectorControl(
    {
      id: "opacity",
      kind: "range",
      label: "透明度",
      icon: "opacity",
      value: selection.styles.opacity,
      min: 0,
      max: 1,
      step: 0.05,
    },
      "website-appearance",
      "外观",
      "opacity",
    ),
    inspectorControl(
    {
      id: "display",
      kind: "select",
      label: "显示",
      icon: "position",
      value: selection.styles.display,
      options: [
        { value: "block", label: "块" },
        { value: "flex", label: "弹性" },
        { value: "grid", label: "网格" },
        { value: "inline", label: "行内" },
        { value: "inline-block", label: "行内块" },
        { value: "inline-flex", label: "行内弹性" },
        { value: "none", label: "隐藏" },
      ],
    },
      "website-layout",
      "布局与间距",
      "position",
    ),
    inspectorControl(
    {
      id: "gap",
      kind: "range",
      label: "间距",
      icon: "spacing",
      value: selection.styles.gap,
      min: 0,
      max: 160,
      suffix: "px",
    },
      "website-layout",
      "布局与间距",
      "spacing",
    ),
    inspectorControl(
    {
      id: "padding",
      kind: "range",
      label: "内边距",
      icon: "spacing",
      value: selection.styles.padding,
      min: 0,
      max: 160,
      suffix: "px",
    },
      "website-layout",
      "布局与间距",
      "spacing",
    ),
    inspectorControl(
    {
      id: "margin",
      kind: "range",
      label: "外边距",
      icon: "spacing",
      value: selection.styles.margin,
      min: 0,
      max: 160,
      suffix: "px",
    },
      "website-layout",
      "布局与间距",
      "spacing",
    ),
  ];
}

function layoutControls(selection: DomSelection): WebsiteSelectionControl[] {
  const controls: SelectionControl[] = [
    {
      id: "layout-x",
      kind: "number",
      label: "X",
      icon: "position",
      value: Number.isFinite(selection.styles.x)
        ? selection.styles.x
        : 0,
      min: -4_000,
      max: 4_000,
      placement: "more",
    },
    {
      id: "layout-y",
      kind: "number",
      label: "Y",
      icon: "position",
      value: Number.isFinite(selection.styles.y)
        ? selection.styles.y
        : 0,
      min: -4_000,
      max: 4_000,
      placement: "more",
    },
    {
      id: "layout-w",
      kind: "number",
      label: "宽",
      icon: "position",
      value: Number.isFinite(selection.styles.width)
        ? selection.styles.width
        : selection.anchor.width,
      min: 1,
      max: 8_000,
      placement: "more",
    },
    {
      id: "layout-h",
      kind: "number",
      label: "高",
      icon: "position",
      value: Number.isFinite(selection.styles.height)
        ? selection.styles.height
        : selection.anchor.height,
      min: 1,
      max: 8_000,
      placement: "more",
    },
    {
      id: "layout-order",
      kind: "number",
      label: "顺序",
      icon: "layers",
      value: Number.isFinite(selection.styles.order)
        ? selection.styles.order
        : 0,
      min: -1_000,
      max: 1_000,
      placement: "more",
    },
  ];
  return controls.map((control) => ({
    ...control,
    slot: "inspector" as const,
    inspectorGroup: "website-position",
    inspectorLabel: "位置与尺寸",
    inspectorIcon: "position" as const,
  }));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

/**
 * Messages from the dev iframe stay untrusted even though their source and
 * origin are pinned. A malformed structured selection must never partially
 * reach the shared toolbar or the deterministic mutation endpoint.
 */
export function normalizeDomSelection(
  value: unknown,
  breakpoint: WebsiteEditorBreakpoint = "desktop",
): DomSelection | null {
  const source = objectRecord(value);
  const attributes = objectRecord(source?.attributes);
  const styles = objectRecord(source?.styles);
  const anchor = objectRecord(source?.anchor);
  if (!source || !attributes || !styles || !anchor) return null;
  const id = boundedString(source.id, 80);
  const revision =
    typeof source.revision === "string" &&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(source.revision)
      ? source.revision
      : typeof source.revision === "number" &&
          Number.isSafeInteger(source.revision) &&
          source.revision >= 0
        ? source.revision
        : null;
  const tag = boundedString(source.tag, 24);
  const selector = boundedString(source.selector, 500);
  const label = boundedString(source.label, 120);
  const text = boundedString(source.text, 4_000);
  const outerHTML = boundedString(source.outerHTML, 4_000);
  const color = boundedString(styles.color, 100);
  const background = boundedString(styles.background, 100);
  const fontFamily = boundedString(styles.fontFamily, 20);
  const fontWeight = boundedString(styles.fontWeight, 16);
  const textAlign = boundedString(styles.textAlign, 16);
  const display = boundedString(styles.display, 24);
  const borderColor = boundedString(styles.borderColor, 100);
  const borderStyle = boundedString(styles.borderStyle, 16);
  const numericStyles = {
    fontSize: finiteNumber(styles.fontSize, 1, 512),
    borderRadius: finiteNumber(styles.borderRadius, 0, 512),
    padding: finiteNumber(styles.padding, 0, 1_000),
    margin: finiteNumber(styles.margin, 0, 1_000),
    opacity: finiteNumber(styles.opacity, 0, 1),
    gap: finiteNumber(styles.gap, 0, 1_000),
    borderWidth: finiteNumber(styles.borderWidth, 0, 32),
    x: finiteNumber(styles.x, -100_000, 100_000),
    y: finiteNumber(styles.y, -100_000, 100_000),
    width: finiteNumber(styles.width, 0, 100_000),
    height: finiteNumber(styles.height, 0, 100_000),
    order: finiteNumber(styles.order, -100_000, 100_000),
  };
  const normalizedAnchor = {
    x: finiteNumber(anchor.x, -10_000_000, 10_000_000),
    y: finiteNumber(anchor.y, -10_000_000, 10_000_000),
    width: finiteNumber(anchor.width, 0, 10_000_000),
    height: finiteNumber(anchor.height, 0, 10_000_000),
  };
  if (
    !id ||
    !isStableEditorId(id) ||
    revision === null ||
    !tag ||
    !/^[a-z][a-z0-9-]{0,23}$/.test(tag) ||
    selector === null ||
    label === null ||
    text === null ||
    outerHTML === null ||
    typeof source.textEditable !== "boolean" ||
    color === null ||
    background === null ||
    !["sans", "serif", "mono"].includes(fontFamily || "") ||
    fontWeight === null ||
    textAlign === null ||
    display === null ||
    borderColor === null ||
    borderStyle === null ||
    Object.values(numericStyles).some((item) => item === null) ||
    Object.values(normalizedAnchor).some((item) => item === null)
  ) {
    return null;
  }
  const src = boundedString(attributes.src, 2_000);
  const alt = boundedString(attributes.alt, 500);
  const href = boundedString(attributes.href, 2_000);
  const poster = boundedString(attributes.poster, 2_000);
  if (src === null || alt === null || href === null || poster === null) {
    return null;
  }
  return {
    id,
    revision,
    breakpoint,
    selector,
    tag,
    label,
    text,
    textEditable: source.textEditable,
    ...(typeof source.layoutEditable === "boolean"
      ? { layoutEditable: source.layoutEditable }
      : {}),
    ...(typeof source.structuralEditable === "boolean"
      ? { structuralEditable: source.structuralEditable }
      : {}),
    outerHTML,
    attributes: { src, alt, href, poster },
    styles: {
      color,
      background,
      fontFamily: fontFamily as string,
      fontWeight,
      textAlign,
      borderStyle,
      display,
      ...(numericStyles as {
        fontSize: number;
        borderRadius: number;
        padding: number;
        margin: number;
        opacity: number;
        gap: number;
        borderWidth: number;
        x: number;
        y: number;
        width: number;
        height: number;
        order: number;
      }),
      borderColor,
    },
    anchor: normalizedAnchor as {
      x: number;
      y: number;
      width: number;
      height: number;
    },
  };
}

/**
 * The host toolbar is only exposed for semantic ids that the deterministic
 * mutation endpoint can address. Arbitrary DOM hashes intentionally get no
 * controls and therefore can never fall through to an Agent rewrite.
 */
export function selectionContext(
  selection: DomSelection | null,
): WebsiteSelectionContext | null {
  if (!selection || !isStableEditorId(selection.id)) return null;
  const structuralEditable =
    selection.structuralEditable ??
    (/^(?:section:|nav:)/.test(selection.id) ||
      /^field:[^:]+:(?:items|features|plans|links):\d+$/.test(selection.id) ||
      /^field:[^:]+:plans:\d+:highlights:\d+$/.test(selection.id));
  const layoutEditable = selection.layoutEditable === true;
  const controls: WebsiteSelectionControl[] = [];
  controls.push(breakpointControl(selection));
  if (
    selection.tag === "img" ||
    selection.tag === "video" ||
    selection.tag === "audio"
  ) {
    controls.push(
      inspectorControl(
        {
          id: "src",
          kind: "text",
          label: "素材地址",
          icon: "image",
          value: selection.attributes.src,
        },
        "website-media",
        "素材",
        "image",
      ),
    );
  }
  if (selection.tag === "img") {
    controls.push(
      inspectorControl(
        {
          id: "alt",
          kind: "text",
          label: "替代文字",
          icon: "image",
          value: selection.attributes.alt,
        },
        "website-media",
        "素材",
        "image",
      ),
    );
  }
  if (selection.tag === "video") {
    controls.push(
      inspectorControl(
        {
          id: "poster",
          kind: "text",
          label: "封面地址",
          icon: "image",
          value: selection.attributes.poster,
        },
        "website-media",
        "素材",
        "image",
      ),
    );
  }
  if (selection.tag === "a" && selection.id !== "site-name") {
    controls.push(
      inspectorControl(
        {
          id: "href",
          kind: "text",
          label: "链接",
          icon: "link",
          value: selection.attributes.href,
        },
        "website-link",
        "链接",
        "link",
      ),
    );
  }
  controls.push(
    ...styleControls(selection),
    ...(layoutEditable ? layoutControls(selection) : []),
    ...(structuralEditable
      ? [
          {
            id: "move-up",
            kind: "action",
            label: "前移",
            icon: "bring-forward",
            placement: "more",
            slot: "inspector",
            inspectorGroup: "website-structure",
            inspectorLabel: "结构与层级",
            inspectorIcon: "layers",
          },
          {
            id: "move-down",
            kind: "action",
            label: "后移",
            icon: "send-backward",
            placement: "more",
            slot: "inspector",
            inspectorGroup: "website-structure",
            inspectorLabel: "结构与层级",
            inspectorIcon: "layers",
          },
          {
            id: "duplicate",
            kind: "action",
            label: "复制",
            icon: "duplicate",
            placement: "more",
            slot: "inspector",
            inspectorGroup: "website-structure",
            inspectorLabel: "结构与层级",
            inspectorIcon: "layers",
          },
          {
            id: "delete",
            kind: "action",
            label: "删除",
            icon: "delete",
            danger: true,
            placement: "more",
            slot: "inspector",
            inspectorGroup: "website-structure",
            inspectorLabel: "结构与层级",
            inspectorIcon: "layers",
          },
        ] satisfies WebsiteSelectionControl[]
      : []),
  );
  return {
    version: 1,
    kind: `website-${selection.tag}`,
    id: selection.id,
    label: selection.label || selection.tag,
    text: selection.text,
    revision: selection.revision,
    ...(selection.epoch !== undefined ? { epoch: selection.epoch } : {}),
    anchor: selection.anchor,
    controls,
  };
}
