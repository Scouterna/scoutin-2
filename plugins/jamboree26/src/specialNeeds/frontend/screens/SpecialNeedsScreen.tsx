import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  assignment: type({
    label: "string",
    value: "string",
  }).array(),
  diet: type({
    allergens: "string[]",
    other: "string | null",
  }),
  medicalElectricityNeeded: "boolean",
  absence: type({
    label: "string",
    days: type({
      date: "string",
      present: "boolean",
    }).array(),
  }).array(),
});

function AttendanceTable({
  days,
}: {
  days: { date: string; present: boolean }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            {days.map((d) => (
              <th
                key={d.date}
                className="border border-neutral-200 px-2 py-1 text-body-sm font-normal text-neutral-600"
              >
                {d.date}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {days.map((d) => (
              <td
                key={d.date}
                className="border border-neutral-200 px-2 py-1 text-center"
              >
                {d.present ? (
                  <span className="text-green-600">✅</span>
                ) : (
                  <span className="text-neutral-400">❌</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function SpecialNeedsScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const { assignment, diet, medicalElectricityNeeded, absence } = validPayload;

  const handleConfirm = () => {
    socket?.send({
      name: "step:callMethod",
      data: { name: "confirm" },
    });
  };

  return (
    <div className="h-full overflow-y-auto flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          Dina registrerade uppgifter
        </h1>
        <p className="text-body-base">
          Detta är hämtat från din anmälan. Kontrollera att allt stämmer och
          stäm av om funktionären behöver tillgång till medicinsk el.
        </p>
      </div>

      {assignment.length > 0 && (
        <ScoutCallout variant="info" heading="Allokering">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {assignment.map((entry) => (
              <div key={entry.label} className="contents">
                <dt className="font-semibold">{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </ScoutCallout>
      )}

      <ScoutCallout variant="info" heading="Specialkost">
        {diet.allergens.length === 0 && !diet.other && <p>Inga registrerade</p>}
        {diet.allergens.length > 0 && <p>{diet.allergens.join(", ")}</p>}
        {diet.other && <p>Övrigt: {diet.other}</p>}
      </ScoutCallout>

      <ScoutCallout variant="info" heading="Medicinskt behov">
        {medicalElectricityNeeded
          ? "Behöver el vid boplatsen"
          : "Inget registrerat"}
      </ScoutCallout>

      {absence.map((entry) => (
        <ScoutCallout key={entry.label} variant="info" heading={entry.label}>
          <AttendanceTable days={entry.days} />
        </ScoutCallout>
      ))}

      <div className="flex justify-end">
        <ScoutButton variant="primary" onScoutClick={handleConfirm}>
          Nästa
        </ScoutButton>
      </div>
    </div>
  );
}
