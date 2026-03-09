import type { UiDensity, UiSurface } from "./contracts";

export const primitiveTokens = {
  color: {
    stone: {
      0: "#fffef9",
      25: "#fbf7ef",
      50: "#f4ecdd",
      100: "#e4d8c3",
    },
    ink: {
      950: "#101417",
      900: "#172027",
      800: "#24303b",
      700: "#4d5d69",
      500: "#80909d",
      300: "#b7c4cd",
    },
    citrus: {
      400: "#d8ff3e",
      500: "#c4ec39",
      700: "#728d16",
    },
    aqua: {
      400: "#8ce7ff",
      500: "#50c7eb",
      700: "#176d86",
    },
    coral: {
      400: "#ff9d7d",
      500: "#ff775d",
      700: "#a24634",
    },
    amber: {
      400: "#ffd26c",
      500: "#f4bb46",
    },
    success: {
      400: "#5ec78d",
      700: "#1f6c48",
    },
    danger: {
      400: "#ff8aa3",
      700: "#8a304c",
    },
  },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    7: "28px",
    8: "32px",
    10: "40px",
    12: "48px",
  },
  radius: {
    sm: "10px",
    md: "16px",
    lg: "22px",
    xl: "30px",
    round: "999px",
    square: "0px",
  },
  shadow: {
    panel: "0 24px 64px rgba(16, 20, 23, 0.1)",
    raised: "0 22px 54px rgba(16, 20, 23, 0.14)",
    floating: "0 32px 74px rgba(16, 20, 23, 0.18)",
    overlay: "0 28px 72px rgba(0, 0, 0, 0.36)",
  },
  motion: {
    micro: "140ms",
    ui: "180ms",
    layout: "240ms",
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  },
  opacity: {
    subtle: "0.08",
    soft: "0.14",
    strong: "0.24",
  },
  z: {
    shell: "40",
    popover: "44",
    modal: "46",
  },
  typography: {
    family: {
      display: "\"Space Grotesk\", \"Avenir Next\", \"Segoe UI\", sans-serif",
      body: "\"Space Grotesk\", \"Avenir Next\", \"Segoe UI\", sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    },
    size: {
      xs: "0.74rem",
      sm: "0.84rem",
      md: "0.94rem",
      lg: "1.1rem",
      xl: "1.45rem",
      display: "clamp(2.5rem, 5vw, 4.8rem)",
    },
  },
} as const;

export const semanticTokens = {
  app: {
    pageWash:
      "radial-gradient(1200px 560px at 12% 0%, rgba(216, 255, 62, 0.18), transparent 52%), radial-gradient(1100px 620px at 100% 8%, rgba(80, 199, 235, 0.18), transparent 46%), linear-gradient(180deg, #fffef9 0%, #f8f3e8 48%, #f3ede2 100%)",
    pageFill: "rgba(255, 255, 255, 0.16)",
    surfaceBase: "rgba(255, 255, 255, 0.74)",
    surfacePanel: "rgba(255, 255, 255, 0.82)",
    surfacePanelStrong: "rgba(255, 255, 255, 0.94)",
    surfacePanelMuted: "rgba(246, 237, 221, 0.82)",
    surfaceRaised: "rgba(255, 255, 255, 0.98)",
    surfaceOverlay: "rgba(255, 255, 255, 0.96)",
    surfaceOverlaySoft: "rgba(252, 247, 239, 0.9)",
    textPrimary: "#101417",
    textSecondary: "#33414a",
    textMuted: "#667782",
    textInverse: "#fffef9",
    borderSubtle: "rgba(23, 32, 39, 0.08)",
    borderStrong: "rgba(23, 32, 39, 0.16)",
    borderContrast: "rgba(23, 32, 39, 0.3)",
    borderFocus: "rgba(80, 199, 235, 0.5)",
    accentPrimary: "#d8ff3e",
    accentPrimaryStrong: "#c4ec39",
    accentSecondary: "#50c7eb",
    accentTertiary: "#ff775d",
    backdropScrim: "rgba(16, 20, 23, 0.18)",
    controlBg: "rgba(255, 255, 255, 0.82)",
    controlBgHover: "rgba(255, 255, 255, 0.96)",
    controlBgActive: "rgba(244, 236, 221, 0.94)",
    controlBorder: "rgba(23, 32, 39, 0.12)",
    controlBorderStrong: "rgba(23, 32, 39, 0.22)",
    controlPlaceholder: "#8a989f",
    focusRing: "0 0 0 4px rgba(80, 199, 235, 0.14)",
  },
  canvasOverlay: {
    pageWash: "#060606",
    pageFill: "transparent",
    surfaceBase: "rgba(18, 24, 28, 0.74)",
    surfacePanel: "rgba(17, 22, 26, 0.84)",
    surfacePanelStrong: "rgba(17, 22, 26, 0.94)",
    surfacePanelMuted: "rgba(25, 31, 37, 0.88)",
    surfaceRaised: "rgba(14, 18, 22, 0.98)",
    surfaceOverlay: "rgba(14, 18, 22, 0.94)",
    surfaceOverlaySoft: "rgba(18, 24, 28, 0.9)",
    textPrimary: "#f7fafc",
    textSecondary: "#d6dfe6",
    textMuted: "#9baab5",
    textInverse: "#101417",
    borderSubtle: "rgba(255, 255, 255, 0.08)",
    borderStrong: "rgba(255, 255, 255, 0.16)",
    borderContrast: "rgba(255, 255, 255, 0.34)",
    borderFocus: "rgba(216, 255, 62, 0.46)",
    accentPrimary: "#d8ff3e",
    accentPrimaryStrong: "#c4ec39",
    accentSecondary: "#8ce7ff",
    accentTertiary: "#ff9d7d",
    backdropScrim: "rgba(0, 0, 0, 0.38)",
    controlBg: "rgba(255, 255, 255, 0.08)",
    controlBgHover: "rgba(255, 255, 255, 0.12)",
    controlBgActive: "rgba(255, 255, 255, 0.18)",
    controlBorder: "rgba(255, 255, 255, 0.14)",
    controlBorderStrong: "rgba(255, 255, 255, 0.24)",
    controlPlaceholder: "#93a1ab",
    focusRing: "0 0 0 4px rgba(216, 255, 62, 0.12)",
  },
  states: {
    success: {
      bg: "rgba(94, 199, 141, 0.16)",
      fg: "#1f6c48",
      border: "rgba(94, 199, 141, 0.32)",
    },
    warning: {
      bg: "rgba(244, 187, 70, 0.16)",
      fg: "#7a5311",
      border: "rgba(244, 187, 70, 0.3)",
    },
    danger: {
      bg: "rgba(255, 138, 163, 0.16)",
      fg: "#8a304c",
      border: "rgba(255, 138, 163, 0.3)",
    },
    info: {
      bg: "rgba(80, 199, 235, 0.14)",
      fg: "#176d86",
      border: "rgba(80, 199, 235, 0.28)",
    },
    accent: {
      bg: "rgba(216, 255, 62, 0.18)",
      fg: "#5b7012",
      border: "rgba(196, 236, 57, 0.3)",
    },
    neutral: {
      bg: "rgba(23, 32, 39, 0.06)",
      fg: "#3e4b54",
      border: "rgba(23, 32, 39, 0.12)",
    },
  },
} as const;

export const componentTokens = {
  button: {
    paddingX: "16px",
    paddingXSmall: "12px",
    gap: "10px",
  },
  panel: {
    radius: "22px",
    padding: "24px",
    paddingCompact: "18px",
  },
  popover: {
    radius: "18px",
    blur: "16px",
  },
  modal: {
    radius: "24px",
  },
  shell: {
    menuRadius: "18px",
    queueRadius: "20px",
  },
} as const;

export function tokenPathToCssVariableName(path: string[]) {
  return `--ds-${path.join("-")}`;
}

function flattenTokenObject(input: Record<string, unknown>, path: string[] = []) {
  return Object.entries(input).flatMap(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenTokenObject(value as Record<string, unknown>, [...path, key]);
    }
    return [{ path: [...path, key], cssVariableName: tokenPathToCssVariableName([...path, key]), value: String(value) }];
  });
}

export const designSystemTokenVariables = {
  primitive: flattenTokenObject(primitiveTokens),
  semantic: flattenTokenObject(semanticTokens),
  component: flattenTokenObject(componentTokens),
} as const;

export const defaultUiSurface: UiSurface = "app";
export const defaultUiDensity: UiDensity = "comfortable";
