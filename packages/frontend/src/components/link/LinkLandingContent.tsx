import { ScoutButton } from "@scouterna/ui-react";

type Props = {
  onStart: () => void;
  starting?: boolean;
};

export function LinkLandingContent({ onStart, starting }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-heading-lg font-semibold text-blue-700 leading-tight">
        Välkommen till Jamboree26!
      </h1>
      <p className="text-body-2xl">
        Klicka på knappen för att starta din incheckning.
      </p>
      <ScoutButton
        variant="primary"
        onScoutClick={() => {
          if (!starting) onStart();
        }}
      >
        {starting ? "Startar..." : "Starta"}
      </ScoutButton>
    </div>
  );
}
