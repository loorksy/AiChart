import type { AgentAvatarState } from "@/components/AnimatedAgentAvatar";
import type { VoiceSessionStatus } from "./types";

/** Map live voice session status onto the animated face mark. */
export function voiceStatusToAvatarState(
  status: VoiceSessionStatus,
): AgentAvatarState {
  switch (status) {
    case "requesting_permission":
    case "connecting":
    case "connected":
      return "connecting";
    case "listening":
    case "user_speaking":
      return "listening";
    case "processing":
      return "thinking";
    case "assistant_speaking":
      return "speaking";
    case "reconnecting":
      return "reconnecting";
    case "error":
      return "error";
    case "idle":
    case "stopping":
    case "stopped":
    default:
      return "idle";
  }
}
