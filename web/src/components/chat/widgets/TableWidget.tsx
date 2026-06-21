"use client";

import React from "react";

interface TableWidgetProps {
  headers: string[];
  rows: (string | number)[][];
  caption?: string;
}

export default function TableWidget({
  headers = [],
  rows = [],
  caption,
}: TableWidgetProps) {
  if (!headers.length && !rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/45 p-6 text-center text-xs text-muted-foreground">
        لا توجد بيانات للعرض في الجدول.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card/30 shadow-md">
      <table className="w-full text-xs text-start border-collapse">
        {caption && (
          <caption className="p-3 text-start font-semibold text-foreground border-b border-border/50 bg-card/45">
            {caption}
          </caption>
        )}
        
        <thead>
          <tr className="border-b border-border/50 bg-background/50 text-muted-foreground font-semibold">
            {headers.map((header, idx) => (
              <th key={idx} className="p-3 text-start whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        
        <tbody className="divide-y divide-border/40">
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-white/[0.02] transition duration-150">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className="p-3 text-start text-foreground whitespace-nowrap" dir="auto">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
