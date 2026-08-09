export interface LiveReasoningEntry {
  type: "observation" | "structure" | "pattern" | "risk" | "decision" | "drawing";
  text: string;
  relatedDrawingIndex?: number;
}
