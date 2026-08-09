"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Wrap any component in a smooth fade-in + slight upward shift.
 * Used to ensure skeletons transition seamlessly to real content
 * without jarring CLS. This is purely visual — does not alter
 * business logic or data flow.
 */
export function FadeIn({
  children,
  className,
  duration = 0.35,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Duration in seconds (default 0.35s) */
  duration?: number;
  /** Initial delay before the animation starts */
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94], /* easeOutQuad */
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * A staggered fade-in container — each direct child fades in
 * sequentially with a small delay offset.
 */
export function FadeInStagger({
  children,
  className,
  staggerDelay = 0.06,
}: {
  children: ReactNode;
  className?: string;
  /** Delay between each child (seconds) */
  staggerDelay?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: staggerDelay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Individual child of FadeInStagger.
 */
export function FadeInItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
