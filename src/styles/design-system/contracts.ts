export const uiSurfaces = ["app", "canvas-overlay"] as const;
export type UiSurface = (typeof uiSurfaces)[number];

export const uiDensities = ["comfortable", "compact"] as const;
export type UiDensity = (typeof uiDensities)[number];

export const uiButtonVariants = ["primary", "secondary", "ghost", "danger"] as const;
export type UiButtonVariant = (typeof uiButtonVariants)[number];

export const uiButtonSizes = ["md", "sm"] as const;
export type UiButtonSize = (typeof uiButtonSizes)[number];

export const uiPanelVariants = ["hero", "panel", "subtle", "raised", "shell"] as const;
export type UiPanelVariant = (typeof uiPanelVariants)[number];

export const uiBadgeVariants = ["neutral", "accent", "success", "warning", "danger", "info"] as const;
export type UiBadgeVariant = (typeof uiBadgeVariants)[number];
