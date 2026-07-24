import { ScoutButton } from "@scouterna/ui-react";

type Props = {
  onStart: () => void;
  starting?: boolean;
};

/**
 * Shown before the session socket is authenticated, i.e. before any language
 * has been chosen - so everything here is deliberately bilingual rather than
 * guessing a locale. Language selection happens on the first step of the flow
 * (`base:selectLanguage`).
 */
export function LinkLandingContent({ onStart, starting }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-heading-lg font-semibold text-blue-700 leading-tight">
          Välkommen till Jamboree26!
        </h1>
        <h2 className="text-heading-sm font-semibold text-blue-700 leading-tight">
          Welcome to Jamboree26!
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-body-2xl">
          Klicka på knappen för att starta din incheckning.
        </p>
        <p className="text-body-lg text-gray-600">
          Tap the button to start your check-in.
        </p>
      </div>
      <ScoutButton
        variant="primary"
        onScoutClick={() => {
          if (!starting) onStart();
        }}
      >
        {starting ? "Startar... / Starting..." : "Starta / Start"}
      </ScoutButton>
    </div>
  );
}
