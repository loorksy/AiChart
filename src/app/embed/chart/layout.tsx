import type { ReactNode } from "react";

/**
 * Chrome-free host for the MCP live TradingView card. The widget iframe
 * (ext-apps `frameDomains`) renders this page; the shell must stay
 * transparent so the host conversation background shows through.
 */
export default function EmbedChartLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        html, body, #main-content {
          background: transparent !important;
          min-height: 100%;
          height: 100%;
        }
        body { padding: 0; margin: 0; }
      `}</style>
      {children}
    </>
  );
}
