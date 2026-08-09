"use client";

import React, { useState, useRef, useEffect } from "react";
import { X, ZoomIn, ZoomOut, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChartLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ChartLightbox({ src, alt = "Chart Preview", onClose }: ChartLightboxProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom controls
  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 4));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Dragging logic for Pan
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Fullscreen support
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.error("Error enabling fullscreen:", err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-in fade-in duration-200"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Controls Bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-4 text-white z-10">
        <h3 className="text-sm font-semibold truncate bg-black/40 px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-sm">
          {alt}
        </h3>
        
        <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-lg border border-white/10 backdrop-blur-sm">
          <button
            onClick={zoomIn}
            className="p-2 hover:bg-white/10 rounded-md transition"
            title="Zoom In"
          >
            <ZoomIn className="h-4.5 w-4.5" />
          </button>
          <button
            onClick={zoomOut}
            className="p-2 hover:bg-white/10 rounded-md transition"
            title="Zoom Out"
          >
            <ZoomOut className="h-4.5 w-4.5" />
          </button>
          <button
            onClick={resetZoom}
            className="px-2 py-1 text-xs font-semibold hover:bg-white/10 rounded-md transition"
            title="Reset View"
          >
            Reset
          </button>
          <div className="h-4 w-px bg-white/10 mx-1" />
          <button
            onClick={toggleFullscreen}
            className="p-2 hover:bg-white/10 rounded-md transition"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4.5 w-4.5" />
            ) : (
              <Maximize2 className="h-4.5 w-4.5" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-2 bg-destructive/20 hover:bg-destructive/30 text-destructive-foreground rounded-md transition ml-1"
            title="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* Image Canvas */}
      <div
        className={cn(
          "w-full h-full flex items-center justify-center overflow-hidden cursor-grab",
          isDragging && "cursor-grabbing"
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        <img
          src={src}
          alt={alt}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? "none" : "transform 0.15s ease-out",
          }}
          className="max-w-[90%] max-h-[85%] rounded-lg border border-white/10 shadow-2xl object-contain select-none pointer-events-none"
        />
      </div>
    </div>
  );
}
