import {
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutListView } from "@scouterna/ui-react";
import { type } from "arktype";
import { useState } from "react";

const Subject = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  safeFromHarmOk: "boolean",
  criminalRecordExtractOk: "boolean",
});

const Payload = type({
  subjects: Subject.array(),
  "title?": "string",
  message: "string",
});

const dict = {
  sv: {
    title: "Ledare som saknar krav",
    safeFromHarm: "Trygga Möten",
    criminalRecordExtract: "registerutdrag",
    missing: "Saknar: {items}",
    continue: "Fortsätt",
  },
  en: {
    title: "Leaders missing requirements",
    safeFromHarm: "Safe from Harm",
    criminalRecordExtract: "criminal record extract",
    missing: "Missing: {items}",
    continue: "Continue",
  },
};

// Mirrors list-view-item.css so display-only rows match a real ScoutListViewItem
// (which is always interactive - button/link/radio/checkbox - so it can't be
// reused here). Same pattern as base:filterSubjects' FilterSubjectsScreen.
const rowStyle = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  minHeight: "var(--spacing-12)",
  padding: "var(--spacing-4)",
  backgroundColor: "var(--color-white)",
  border: "1px solid var(--color-gray-100)",
  borderRadius: "6px",
  boxShadow: "0 1px 2px rgba(0, 22, 45, 0.04)",
} as const;

/**
 * Informational report (never blocks) listing the leaders who are missing Safe
 * from Harm and/or a criminal record extract, shown to the leader running a
 * groups check-in. Only non-compliant subjects reach this screen (the backend
 * filters and skips it entirely when everyone applicable is OK).
 */
export function ComplianceGateReportScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

  // Once confirm is sent the step advances; a second send would land on the
  // next step (which has no `confirm` method) and surface as a spurious error.
  // Guard the button so it can only fire once while this screen is shown.
  const [submitting, setSubmitting] = useState(false);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const confirm = () => {
    if (submitting) return;
    setSubmitting(true);
    socket?.send({ name: "step:callMethod", data: { name: "confirm" } });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? t("title")}
        </h1>
        <p className="text-body-base">{validPayload.message}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ScoutListView>
          {validPayload.subjects.map((subject) => {
            const missing = [
              !subject.safeFromHarmOk && t("safeFromHarm"),
              !subject.criminalRecordExtractOk && t("criminalRecordExtract"),
            ].filter((v): v is string => Boolean(v));
            return (
              <div key={subject.id} style={rowStyle}>
                <span className="text-body-base font-semibold">
                  {subject.firstName} {subject.lastName}
                </span>
                <span className="text-body-small text-neutral-500">
                  {t("missing", { items: missing.join(", ") })}
                </span>
              </div>
            );
          })}
        </ScoutListView>
      </div>

      <div className="flex justify-end">
        <ScoutButton
          variant="primary"
          onScoutClick={confirm}
          disabled={submitting}
        >
          {t("continue")}
        </ScoutButton>
      </div>
    </div>
  );
}
