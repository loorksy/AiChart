/**
 * Gold Agent X learning is versioned and offline. It consumes only canonical,
 * explicitly validated recommendation evidence and never mutates live weights.
 */
export {
  activateGoldWeightVersion,
  listGoldWeightVersions,
  proposeGoldWeightVersion,
  rollbackGoldWeightVersion,
} from "@/lib/recommendations/canonical/goldLearning";
