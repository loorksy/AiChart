import { WorkspaceSkeleton } from "@/components/ui/skeletons/page-skeletons";

/**
 * /workspace is the trader workspace (chart + chat), so its loading state must
 * be the workspace — the old console-overview skeleton described a metrics
 * page this route stopped rendering.
 */
export default function WorkspaceLoading() {
  return <WorkspaceSkeleton />;
}
