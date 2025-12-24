import { ScoutButton } from "@scouterna/ui-react";
import type { ReactNode } from "react";
import { cn } from "@/utils";
import ScouternaTagline from "../../assets/scouterna_tagline.svg?react";
import topography from "../../assets/topography.png";
import Wave from "../../assets/wave.svg?react";
import ArrowLeftIcon from "@tabler/icons/outline/arrow-left.svg?raw";

// import

export type Props = {
  children: ReactNode;
  heroContent: ReactNode;
  progressed: boolean;
  showBackButton: boolean;
  onBackClick: () => void;
};

export function HeroLayout({
  children,
  heroContent,
  progressed,
  showBackButton,
  onBackClick,
}: Props) {
  // Two column hero layout

  return (
    <div className="relative w-full h-full flex bg-background-brand-base overflow-hidden">
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
        {heroContent}

        <Wave
          className="absolute top-0 -right-full w-full h-full fill-white pointer-events-none -translate-x-[2px]"
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
            "absolute h-2/5 max-w-none top-0 left-full -translate-x-[60%] -translate-y-[20%]",
            "transition-all duration-1000",
            !progressed ? "duration-700 delay-700" : "opacity-0 duration-300",
          )}
        />
        <img
          src={topography}
          alt="An illustration of the topography lines of a map, partially cut off by the corner of the screen."
          className={cn(
            "pointer-events-none",
            "absolute h-[2/5] max-w-none top-full left-0 -translate-x-[40%] -translate-y-[68%]",
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
            // <button
            //   type="button"
            //   className="w-full flex justify-left items-center gap-2 text-white font-bold text-3xl py-8 px-10"
            //   onClick={onBackClick}
            //   onFocus={(e) => e.target.blur()}
            // >
            //   <ArrowLeft size={"1.5em"} />
            //   Gå tillbaka
            // </button>

            <ScoutButton
              variant="text"
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
          "absolute top-0 h-full w-[77%] z-10 bg-white flex flex-col pt-40 px-32 pb-16",
          "transition-all duration-1000",
          !progressed ? "left-[120%]" : "left-[23%]",
        )}
      >
        <Wave
          className="absolute top-0 -left-full w-full h-full fill-white pointer-events-none translate-x-[2px] rotate-180"
          aria-hidden
        />
        {children}
      </div>
    </div>
  );
}
