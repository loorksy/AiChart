from pathlib import Path
import re

p = Path(r"C:\Users\ALALMIA\Documents\GitHub\AiChart\web\src\components\admin\AdminKeysPanel.tsx")
text = p.read_text(encoding="utf-8")
new = """                  {agentModel && (
                    <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      نموذج المنصة (MCP):{" "}
                      <code dir="ltr">{agentModel.platformRef}</code>
                      {agentModel.fallbacks.length > 0 && (
                        <>
                          {" · "}
                          fallbacks:{" "}
                          <code dir="ltr">
                            {agentModel.fallbacks.join(", ")}
                          </code>
                        </>
                      )}
                    </p>
                  )}"""
pat = r'\{agentModel && \(\s*<div className="space-y-2">.*?</div>\s*\)\}'
text2, n = re.subn(pat, new, text, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f"replacements={n}")
p.write_text(text2, encoding="utf-8")
print("OK")
