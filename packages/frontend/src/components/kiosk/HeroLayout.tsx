import { ScoutButton } from "@scouterna/ui-react";
import ArrowLeftIcon from "@tabler/icons/outline/arrow-left.svg?raw";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/utils";
import ScouternaLogo from "../../../assets/scouterna_vit.svg?react";

export type Props = {
  children: ReactNode;
  heroContent: ReactNode;
  progressed: boolean;
  showBackButton: boolean;
  onBackClick: () => void;
};

type RidgeProps = { d: string; className?: string };

// Mountain-ridge edges, drawn on a 400x1080 box filled from the left. Each
// sits against the right side of its layer and scales to the screen height.
const RIDGE_FRONT =
  "M0 0H80L175 200L205 330L225 560L290 820L320 930L390 1080H0V0Z";
// The same ridge with a quarter of the sideways travel, for the content panel's edge.
const RIDGE_CONTENT =
  "M0 0H80L104 200L111 330L116 560L133 820L140 930L158 1080H0V0Z";

function Ridge({ d, className }: RidgeProps) {
  return (
    <svg
      viewBox="0 0 400 1080"
      preserveAspectRatio="xMinYMid"
      className={cn(
        "absolute top-0 left-full w-full h-full pointer-events-none -translate-x-0.5",
        className,
      )}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function HeroLayout({
  children,
  heroContent,
  progressed,
  showBackButton,
  onBackClick,
}: Props) {
  const [heroActive, setHeroActive] = useState(true);
  const [contentActive, setContentActive] = useState(false);

  const heroUnloadTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const contentUnloadTimeout = useRef<NodeJS.Timeout | undefined>(undefined);

  const unloadHero = useCallback(() => {
    setHeroActive(false);
  }, []);

  const loadHero = useCallback(() => {
    setHeroActive(true);
  }, []);

  const unloadContent = useCallback(() => {
    setContentActive(false);
  }, []);
  const loadContent = useCallback(() => {
    setContentActive(true);
  }, []);

  useEffect(() => {
    if (progressed) {
      loadContent();
      clearTimeout(contentUnloadTimeout.current);

      if (heroActive) {
        heroUnloadTimeout.current = setTimeout(() => {
          unloadHero();
        }, 500);
      }
    } else {
      loadHero();
      clearTimeout(heroUnloadTimeout.current);

      if (contentActive) {
        contentUnloadTimeout.current = setTimeout(() => {
          unloadContent();
        }, 500);
      }
    }
  }, [
    progressed,
    unloadHero,
    loadHero,
    unloadContent,
    loadContent,
    heroActive,
    contentActive,
  ]);

  return (
    <div className="relative w-full h-full flex bg-background-brand-base overflow-hidden">
      <div
        className={cn(
          "absolute bottom-2 right-2 leading-none text-body-sm text-white",
          "transition-all duration-200",
          !progressed ? "duration-700 delay-700" : "opacity-0 duration-300",
        )}
      >
        {import.meta.env.VITE_APP_VERSION ?? "dev"}
      </div>
      <div
        className={cn(
          "absolute top-0 h-full w-[35%] z-10 bg-white flex flex-col justify-center px-16",
          "transition-all duration-1000",
          !progressed ? "left-0" : "-left-full",
        )}
      >
        {/* Keeps the text at its old width; past the panel it sits on the
            white ridge, which is wide enough at text height. */}
        <div className="relative z-10 w-[calc(45vw-8rem)]">
          {heroActive && heroContent}
        </div>

        <Ridge d={RIDGE_FRONT} className="fill-white" />
      </div>
      <div
        className={cn(
          "absolute top-0 h-full flex-1 px-16 flex justify-center items-center",
          "transition-all duration-1000",
          !progressed
            ? "left-[calc(35%+20.5vh)] w-[calc(65%-20.5vh)]"
            : "left-0 w-[25%]",
        )}
      >
        <ScouternaLogo
          className={cn(
            "w-[36vw] shrink-0",
            "transition-all duration-200",
            !progressed ? "duration-700 delay-700" : "opacity-0 duration-300",
          )}
        />

        <div
          className={cn(
            "absolute top-0 left-0 w-full flex p-2",
            "transition-all",
            !progressed ? "opacity-0 duration-300" : "duration-700 delay-700",
          )}
        >
          {showBackButton && (
            <ScoutButton
              variant="text"
              size="large"
              // TODO: Remove this CSS variable hack and move it to the component library somehow
              className="not-hover:[--color-text-brand-base:var(--color-white)]"
              onScoutClick={onBackClick}
              icon={ArrowLeftIcon}
              iconPosition="before"
            >
              Gå tillbaka
            </ScoutButton>
          )}
        </div>
      </div>
      <div
        className={cn(
          "absolute top-0 h-full w-[75%] z-10 bg-white flex flex-col pt-40 px-32 pb-16",
          "transition-all duration-1000",
          !progressed ? "left-[125%]" : "left-[25%]",
        )}
      >
        <Ridge
          d={RIDGE_CONTENT}
          className="left-auto right-full translate-x-0.5 -scale-x-100 fill-white"
        />
        {contentActive && children}
      </div>
    </div>
  );
}
