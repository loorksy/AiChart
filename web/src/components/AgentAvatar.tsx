"use client";

import {
  AnimatedAgentAvatar,
  type AgentAvatarState,
} from "@/components/AnimatedAgentAvatar";

export type { AgentAvatarState };

type AgentAvatarProps = {
  className?: string;
  size?: number;
  /** Decorative (default) — hide from AT when paired with visible text. */
  decorative?: boolean;
  /** Animation state. Defaults to idle breathing. */
  state?: AgentAvatarState;
  /** Optional 0–1 amplitude for speaking. */
  audioLevel?: number;
  /** Accessible label when decorative is false. */
  label?: string;
};

/** Theme-aware animated agent face mark for chat, voice, and empty states. */
export function AgentAvatar({
  className,
  size = 28,
  decorative = true,
  state = "idle",
  audioLevel,
  label,
}: AgentAvatarProps) {
  return (
    <AnimatedAgentAvatar
      state={state}
      size={size}
      audioLevel={audioLevel}
      className={className}
      decorative={decorative}
      label={label}
    />
  );
}
