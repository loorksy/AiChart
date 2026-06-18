/** Lightweight tool metadata constants — avoids rewriting all 48 registerTool calls. */

export const MCP_SERVER_VERSION = "1.1.1";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
};

export const IDEMPOTENT_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
};

/** Spread into registerTool config alongside description + inputSchema. */
export function withAnnotations(annotations: ToolAnnotations) {
  return { annotations };
}

/** Build registerTool config from catalog entry. */
export function toolConfig(def: {
  description: string;
  inputSchema: import("zod").ZodRawShape;
  annotations: ToolAnnotations;
}) {
  return {
    description: def.description,
    inputSchema: def.inputSchema,
    ...withAnnotations(def.annotations),
  };
}
