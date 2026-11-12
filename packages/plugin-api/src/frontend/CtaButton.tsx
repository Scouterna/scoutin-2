import type { ReactNode } from "react";
import { cn } from "./utils.ts";

type Props = {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Shake the background every few seconds to draw attention. */
  shake?: boolean;
  className?: string;
};

// Graphical profile CTA: a flat banner with an uneven left edge and a pointed
// right end. Pixel offsets keep the point's angle at any width.
const SHAPE =
  "polygon(4px 0, calc(100% - 65px) 0, 100% 46%, calc(100% - 48px) 100%, 8px 100%, 0 44%)";

export function CtaButton({
  children,
  onClick,
  disabled,
  shake,
  className,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative isolate flex items-center justify-between gap-8 min-h-20 pl-10 pr-14",
        "text-white! text-body-2xl text-left focus-visible:outline-none",
        "disabled:opacity-60",
        className,
      )}
    >
      {/* Background on its own layer, so it can shake while the text stays. */}
      <span
        aria-hidden="true"
        style={{ clipPath: SHAPE }}
        className={cn(
          "absolute inset-0 -z-10 bg-background-brand-base transition-colors",
          "group-hover:bg-background-brand-hovered group-active:bg-background-brand-pressed",
          "group-focus-visible:bg-background-brand-hovered",
          shake && "motion-safe:animate-shake",
        )}
      />
      <span>{children}</span>
      {/* Tabler's outline arrow-right. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-10 shrink-0"
        aria-hidden="true"
      >
        <path d="M5 12l14 0" />
        <path d="M13 18l6 -6" />
        <path d="M13 6l6 6" />
      </svg>
    </button>
  );
}
