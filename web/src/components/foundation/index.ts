/**
 * Foundation primitives — pure, data-agnostic, RTL-correct, usable from both
 * server and client components (none of them take a hook or a handler).
 *
 * The app's own older kit lives in components/ui and the vendored Square-UI
 * kit in components/squareui; this module is the layer they are composed with,
 * not a replacement for either. Button and Badge stay in components/squareui.
 */
export { PageShell } from "./page-shell";
export type { PageShellProps, PageShellWidth, PageShellGap } from "./page-shell";

export { PageHeader } from "./page-header";
export type { PageHeaderProps } from "./page-header";

export { SectionHeader } from "./section-header";
export type { SectionHeaderProps } from "./section-header";

export { Surface } from "./surface";
export type {
  SurfaceProps,
  SurfaceElement,
  SurfaceElevation,
  SurfacePadding,
} from "./surface";

export { EmptyState } from "./empty-state";
export type { EmptyStateProps, EmptyStateTone, EmptyStateSize } from "./empty-state";

export { StatusDot } from "./status-dot";
export type { StatusDotProps, StatusTone } from "./status-dot";

export { SkipLink } from "./skip-link";
export type { SkipLinkProps } from "./skip-link";
