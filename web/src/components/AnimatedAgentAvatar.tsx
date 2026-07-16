"use client";

import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import styles from "./AnimatedAgentAvatar.module.css";

export type AgentAvatarState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

export type AnimatedAgentAvatarProps = {
  /** Current agent state. Defaults to "idle". */
  state?: AgentAvatarState;
  /** Rendered pixel size (square). Defaults to 48. */
  size?: number;
  /** Live audio amplitude 0–1, used only in the "speaking" state when provided. */
  audioLevel?: number;
  /** Additional class names applied to the root element. */
  className?: string;
  /** Set false if the avatar conveys state changes that matter to screen reader users. */
  decorative?: boolean;
  /** Accessible label, used when decorative is false. */
  label?: string;
};

const DEFAULT_LABEL: Record<AgentAvatarState, string> = {
  idle: "Agent idle",
  connecting: "Agent connecting",
  listening: "Agent listening",
  thinking: "Agent thinking",
  speaking: "Agent speaking",
  reconnecting: "Agent reconnecting",
  error: "Agent needs attention",
};

/**
 * AnimatedAgentAvatar — the AiChart agent's living mark.
 *
 * Two circles + one centered rounded diamond, preserved from the source identity.
 * Motion is CSS-driven via `data-state` so state changes never remount the SVG.
 */
export function AnimatedAgentAvatar({
  state = "idle",
  size = 48,
  audioLevel,
  className,
  decorative = true,
  label,
}: AnimatedAgentAvatarProps) {
  const clampedAudio = useMemo(() => {
    if (typeof audioLevel !== "number" || Number.isNaN(audioLevel)) return 0;
    return Math.min(1, Math.max(0, audioLevel));
  }, [audioLevel]);

  const a11yProps = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": label ?? DEFAULT_LABEL[state] };

  return (
    <div
      className={cn(styles.root, className)}
      data-state={state}
      style={
        {
          width: size,
          height: size,
          "--audio-level": clampedAudio,
        } as CSSProperties
      }
      {...a11yProps}
    >
      <div className={styles.glow} />
      <svg
        className={styles.svg}
        viewBox="0 0 400 400"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g id="agent-avatar-root">
          <circle
            id="agent-eye-left"
            className={`${styles.shape} ${styles.eyeLeft}`}
            cx="99.95"
            cy="159.95"
            r="59.95"
          />
          <circle
            id="agent-eye-right"
            className={`${styles.shape} ${styles.eyeRight}`}
            cx="299.95"
            cy="159.95"
            r="59.95"
          />
          <path
            id="agent-core"
            className={`${styles.shape} ${styles.core}`}
            d="M 216.905,248.155 L 239.445,266.375 Q 256.35,280.04 239.445,293.705 L 216.905,311.925 Q 200,325.59 183.095,311.925 L 160.555,293.705 Q 143.65,280.04 160.555,266.375 L 183.095,248.155 Q 200,234.49 216.905,248.155 Z"
          />
        </g>
      </svg>
    </div>
  );
}

export default AnimatedAgentAvatar;
