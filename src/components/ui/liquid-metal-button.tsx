"use client";

import {
  liquidMetalFragmentShader,
  ShaderFitOptions,
  ShaderMount,
  type ShaderMountUniforms,
} from "@paper-design/shaders";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LiquidMetalButtonProps {
  label?: string;
  viewMode?: "text" | "icon";
  icon?: ReactNode;
  href?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

const ICON_SIZE = 46;
const TEXT_MIN_WIDTH = 142;
const HEIGHT = 46;

const LIQUID_METAL_UNIFORMS: ShaderMountUniforms = {
  u_colorBack: [0, 0, 0, 0],
  u_colorTint: [1, 1, 1, 1],
  u_image: undefined,
  u_isImage: false,
  u_repetition: 4,
  u_softness: 0.5,
  u_shiftRed: 0.3,
  u_shiftBlue: 0.3,
  u_distortion: 0,
  u_contour: 0,
  u_angle: 45,
  u_scale: 8,
  u_shape: 1,
  u_offsetX: 0.1,
  u_offsetY: -0.1,
  u_fit: ShaderFitOptions.contain,
  u_rotation: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_worldWidth: 0,
  u_worldHeight: 0,
};

function mountLiquidMetal(host: HTMLDivElement): ShaderMount | null {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    return new ShaderMount(
      host,
      liquidMetalFragmentShader,
      { ...LIQUID_METAL_UNIFORMS },
      undefined,
      reduce ? 0 : 0.6,
    );
  } catch {
    return null;
  }
}

/**
 * Same liquid-metal ring as the suggestion pills, sized to wrap any surface
 * (the chat composer). The shader paints the frame; children sit on the
 * inner face so the writing field stays readable.
 */
export function LiquidMetalFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const shaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = shaderRef.current;
    if (!host) return;
    const mount = mountLiquidMetal(host);
    return () => mount?.dispose();
  }, []);

  return (
    <div className={cn("liquid-metal-frame", className)}>
      <div ref={shaderRef} className="liquid-metal-frame-shader" aria-hidden />
      <div className="liquid-metal-frame-face">{children}</div>
    </div>
  );
}

/**
 * Liquid-metal pill. The WebGL sheet is the outer ring; a token-colored
 * inner face and the label sit above it. Dimensions match the reference
 * (46×46 icon / ≥142×46 text). Fails closed to the inner face if WebGL
 * cannot mount — the control stays usable.
 */
export function LiquidMetalButton({
  label = "Get Started",
  viewMode = "text",
  icon,
  href,
  type = "button",
  disabled = false,
  onClick,
  className,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>(
    [],
  );
  const shaderRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<ShaderMount | null>(null);
  const hitRef = useRef<HTMLElement>(null);
  const rippleId = useRef(0);
  const styleId = useId().replace(/:/g, "");

  const isIcon = viewMode === "icon";

  useEffect(() => {
    const host = shaderRef.current;
    if (!host) return;

    const mount = mountLiquidMetal(host);
    mountRef.current = mount;

    return () => {
      mount?.dispose();
      mountRef.current = null;
    };
  }, []);

  const setSpeed = (speed: number) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    mountRef.current?.setSpeed(speed);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    setSpeed(1);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    setSpeed(0.6);
  };

  const spawnRipple = (e: MouseEvent<HTMLElement>) => {
    const el = hitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ripple = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      id: rippleId.current++,
    };
    setRipples((prev) => [...prev, ripple]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
    }, 600);
  };

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (disabled) return;
    setSpeed(2.4);
    window.setTimeout(() => setSpeed(isHovered ? 1 : 0.6), 300);
    spawnRipple(e);
    onClick?.();
  };

  const widthStyle: CSSProperties = isIcon
    ? { width: ICON_SIZE, minWidth: ICON_SIZE, height: HEIGHT }
    : { minWidth: TEXT_MIN_WIDTH, height: HEIGHT };

  const press = isPressed
    ? "translateY(1px) scale(0.98)"
    : "translateY(0) scale(1)";

  const hitClass = cn("liquid-metal-hit", disabled && "pointer-events-none opacity-50");
  const hitProps = {
    ref: hitRef as never,
    className: hitClass,
    "aria-label": ariaLabel ?? label,
    "data-testid": testId,
    onClick: handleClick,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onMouseDown: () => setIsPressed(true),
    onMouseUp: () => setIsPressed(false),
  };

  return (
    <div className={cn("liquid-metal", className)} data-style={styleId}>
      <div className="liquid-metal-scene">
        <div className="liquid-metal-stack" style={widthStyle} data-mode={viewMode}>
          <div className="liquid-metal-label" aria-hidden>
            {isIcon ? (
              (icon ?? (
                <Sparkles className="liquid-metal-glyph" size={16} />
              ))
            ) : (
              <span className="liquid-metal-text">{label}</span>
            )}
          </div>

          <div className="liquid-metal-face-layer" style={{ transform: `translateZ(10px) ${press}` }}>
            <div className="liquid-metal-face" />
          </div>

          <div className="liquid-metal-ring-layer" style={{ transform: `translateZ(0) ${press}` }}>
            <div
              className={cn(
                "liquid-metal-ring",
                isPressed && "is-pressed",
                isHovered && !isPressed && "is-hovered",
              )}
            >
              <div ref={shaderRef} className="liquid-metal-shader" />
            </div>
          </div>

          {href ? (
            <Link href={href} {...hitProps}>
              {ripples.map((ripple) => (
                <span
                  key={ripple.id}
                  className="liquid-metal-ripple"
                  style={{ left: ripple.x, top: ripple.y }}
                />
              ))}
            </Link>
          ) : (
            <button type={type} disabled={disabled} {...hitProps}>
              {ripples.map((ripple) => (
                <span
                  key={ripple.id}
                  className="liquid-metal-ripple"
                  style={{ left: ripple.x, top: ripple.y }}
                />
              ))}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
