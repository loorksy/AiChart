"use client";

import { cn } from "@/lib/utils";

export function AmbientBackground({ className }: { className?: string }) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      <div className="absolute -top-[30%] right-[10%] h-[32rem] w-[32rem] rounded-full bg-primary/20 blur-[120px] animate-ambient-1" />
      <div className="absolute top-[20%] -left-[10%] h-[28rem] w-[28rem] rounded-full bg-chart-2/15 blur-[100px] animate-ambient-2" />
      <div className="absolute -bottom-[20%] left-[30%] h-[24rem] w-[24rem] rounded-full bg-chart-3/10 blur-[90px] animate-ambient-3" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iLjkiIG51bU9jdGF2ZXM9IjQiLz48L2ZpbHRlcj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWx0ZXI9InVybCgjYSkiIG9wYWNpdHk9Ii4wMyIvPjwvc3ZnPg==')] opacity-40" />
    </div>
  );
}
