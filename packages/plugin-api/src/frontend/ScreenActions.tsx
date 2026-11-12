import type { ReactNode } from "react";
import { cn } from "./utils.ts";

type Props = { children: ReactNode; className?: string };

/**
 * A screen's button row: right-aligned, wrapping onto more lines when the
 * buttons don't fit side by side. To keep it on screen when the content is
 * tall, make the screen `h-full flex flex-col` with the tall part
 * `min-h-0 overflow-y-auto`, as the message screen does.
 */
export function ScreenActions({ children, className }: Props) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap justify-end gap-4 pt-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
