import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useRef } from "react";
import { cn } from "./utils";

export type Props = {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  className?: string;
};

export function BottomSheet({ open, onClose, children, className }: Props) {
  const dragControls = useDragControls();
  const cardRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(window.innerHeight);
  const scrimOpacity = useTransform(y, [0, window.innerHeight], [1, 0]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            style={{ opacity: scrimOpacity }}
            animate={{ pointerEvents: "auto" }}
            exit={{ pointerEvents: "none" }}
            onClick={onClose}
          />
          <motion.div
            className="fixed -bottom-52 left-0 right-0 w-full flex justify-center pointer-events-none"
            drag="y"
            dragSnapToOrigin
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0.1, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              // Offset contains the distance moved from the starting point, but
              // as the starting point is always at the top since that's where
              // the handle is, we're good.
              const cardPercentage =
                info.offset.y / (cardRef.current?.offsetHeight ?? 1);

              if (info.velocity.y > 300 || cardPercentage > 0.5) {
                onClose();
              }
            }}
            style={{ y }}
            animate={{ y: 0 }}
            exit={{ y: window.innerHeight }}
            transition={{ type: "spring", damping: 29, stiffness: 300 }}
            onAnimationStart={() => {
              const el = cardRef.current?.querySelector<HTMLElement>(
                "input, textarea, select",
              );
              el?.focus();
            }}
          >
            <motion.div
              ref={cardRef}
              className="flex-1 pb-52 max-w-md rounded-t-2xl bg-white pointer-events-auto touch-none"
              animate={{ pointerEvents: "auto" }}
              exit={{ pointerEvents: "none" }}
            >
              <div
                className="flex cursor-grab justify-center py-4 active:cursor-grabbing"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="h-1.5 w-12 rounded-full bg-gray-300" />
              </div>
              <div className={cn(`px-6 pb-4`, className)}>{children}</div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
