/**
 * Public-domain CSS/SVG earth-horizon. No stock/NASA photography.
 * Decorative only — hidden from AT.
 */
export function HorizonBackground() {
  return (
    <div
      className="landing-horizon pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="landing-horizon-space absolute inset-0" />
      <div className="landing-horizon-stars absolute inset-0" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 720"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="landing-earth-body" cx="50%" cy="78%" r="62%">
            <stop offset="0%" stopColor="#0a1628" />
            <stop offset="45%" stopColor="#06101c" />
            <stop offset="78%" stopColor="#03070e" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>
          <linearGradient id="landing-earth-limb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7ec8ff" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#1d6fbf" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#041018" stopOpacity="0" />
          </linearGradient>
          <filter id="landing-atmosphere" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <ellipse
          cx="200"
          cy="780"
          rx="340"
          ry="210"
          fill="url(#landing-earth-body)"
        />
        <ellipse
          cx="200"
          cy="780"
          rx="338"
          ry="208"
          fill="none"
          stroke="#9ad4ff"
          strokeWidth="10"
          filter="url(#landing-atmosphere)"
          opacity="0.85"
        />
        <ellipse
          cx="200"
          cy="780"
          rx="336"
          ry="206"
          fill="none"
          stroke="url(#landing-earth-limb)"
          strokeWidth="3"
        />
      </svg>
      <div className="landing-horizon-vignette absolute inset-0" />
    </div>
  );
}
