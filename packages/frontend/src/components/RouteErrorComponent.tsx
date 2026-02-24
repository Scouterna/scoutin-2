import { ScoutButton, ScoutCard } from "@scouterna/ui-react";
import { useRouter } from "@tanstack/react-router";

export function RouteErrorComponent({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <div className="absolute top-0 left-0 w-full h-full flex flex-col gap-4 items-center justify-center bg-white p-4">
      <ScoutCard>
        <div className="p-6 max-w-2xl max-h-[90vh] overflow-y-auto">
          <h1 className="text-2xl font-bold mb-4">Sidan kunde inte laddas</h1>
          <p className="mb-6 text-gray-700">
            {error.message ||
              "Ett oväntat fel uppstod när sidan skulle laddas."}
          </p>

          <div className="flex gap-4 mb-6">
            <ScoutButton
              variant="primary"
              onScoutClick={() => window.location.reload()}
            >
              Ladda om
            </ScoutButton>
            <ScoutButton onScoutClick={() => router.history.back()}>
              Gå tillbaka
            </ScoutButton>
          </div>

          <details className="text-left">
            <summary className="cursor-pointer mb-2 font-semibold text-gray-600">
              Teknisk information
            </summary>
            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm whitespace-pre-wrap wrap-break-word max-h-60">
              {error.stack}
            </pre>
          </details>
        </div>
      </ScoutCard>
    </div>
  );
}
