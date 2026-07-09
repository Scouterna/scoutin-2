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
import ScouternaTagline from "../../../assets/scouterna_tagline.svg?react";
import topography from "../../../assets/topography.png";
import Wave from "../../../assets/wave.svg?react";

const prefersReducedMotion = window.matchMedia(
  `(prefers-reduced-motion: reduce)`,
).matches;

export type Props = {
  children: ReactNode;
  heroContent: ReactNode;
  progressed: boolean;
  showBackButton: boolean;
  backgroundVideoUrl?: string;
  onBackClick: () => void;
  /** Shown alongside the back button; lets the operator reset immediately
   * (e.g. a new person walks up before the idle timeout would fire). */
  onResetClick?: () => void;
};

export function HeroLayout({
  children,
  heroContent,
  progressed,
  showBackButton,
  backgroundVideoUrl,
  onBackClick,
  onResetClick,
}: Props) {
  const showVideo = backgroundVideoUrl && !prefersReducedMotion;

  const [videoLoaded, setVideoLoaded] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const [heroActive, setHeroActive] = useState(true);
  const [contentActive, setContentActive] = useState(false);

  const heroUnloadTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const contentUnloadTimeout = useRef<NodeJS.Timeout | undefined>(undefined);

  const unloadHero = useCallback(() => {
    setHeroActive(false);
    video.current?.pause();
  }, []);

  const loadHero = useCallback(() => {
    setHeroActive(true);
    video.current?.play();
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
      {showVideo && (
        <video
          ref={video}
          key={backgroundVideoUrl}
          className={cn(
            "absolute top-0 left-0 w-full h-full object-cover pointer-events-none",
            "transition-all duration-400",
            videoLoaded
              ? !progressed
                ? "delay-600 opacity-30"
                : "opacity-0"
              : "opacity-0",
          )}
          src={backgroundVideoUrl}
          autoPlay
          muted
          loop
          onLoadedData={() => setVideoLoaded(true)}
        />
      )}

      <div
        className={cn(
          "absolute bottom-2 right-2 leading-none text-body-sm text-white",
          "transition-all duration-200",
          !progressed ? "duration-700 delay-700" : "opacity-0 duration-300",
        )}
      >
        0.0.0
      </div>

      <div
        className={cn(
          "absolute top-0 h-full w-[45%] z-10 bg-white flex flex-col justify-center px-16",
          "transition-all duration-1000",
          !progressed ? "left-0" : "-left-full",
        )}
      >
        {heroActive && heroContent}

        <Wave
          className="absolute top-0 -right-full w-full h-full fill-white pointer-events-none -translate-x-0.5"
          aria-hidden
        />
      </div>

      <div
        className={cn(
          "absolute top-0 h-full flex-1 px-16 flex justify-center items-center",
          "transition-all duration-1000",
          !progressed ? "left-[45%] w-[55%]" : "left-0 w-[25%]",
        )}
      >
        <img
          src={topography}
          alt="An illustration of the topography lines of a map, partially cut off by the corner of the screen."
          className={cn(
            "pointer-events-none",
            "absolute h-2/5 max-w-none top-0 left-full translate-x-[-60%] translate-y-[-20%]",
            "transition-all duration-1000",
            !progressed ? "duration-700 delay-700" : "opacity-0 duration-300",
          )}
        />
        <img
          src={topography}
          alt="An illustration of the topography lines of a map, partially cut off by the corner of the screen."
          className={cn(
            "pointer-events-none",
            "absolute h-[2/5] max-w-none top-full left-0 translate-x-[-40%] translate-y-[-68%]",
            "transition-all duration-1000",
            !progressed ? "opacity-0 duration-300" : "duration-700 delay-500",
          )}
        />

        <ScouternaTagline
          className={cn(
            "w-[30vw] shrink-0",
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
          {showBackButton && onResetClick && (
            <ScoutButton
              variant="text"
              size="large"
              className="ml-auto not-hover:[--color-text-brand-base:var(--color-white)]"
              onScoutClick={onResetClick}
            >
              Börja om
            </ScoutButton>
          )}
        </div>
      </div>

      <div
        className={cn(
          "absolute top-0 h-full w-[77%] z-10 bg-white flex flex-col pt-40 px-32 pb-16",
          "transition-all duration-1000",
          !progressed ? "left-[120%]" : "left-[23%]",
        )}
      >
        <Wave
          className="absolute top-0 -left-full w-full h-full fill-white pointer-events-none translate-x-0.5 rotate-180"
          aria-hidden
        />
        {contentActive && children}
      </div>
    </div>
  );
}
