import {
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout, ScoutLoader } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  state: "'printing'",
  total: "number",
  finished: "number",
})
  .or({ state: "'needs-help'", total: "number", problems: "number" })
  .or({ state: "'no-printer'", kioskName: "string | null" });

const dict = {
  sv: {
    printingTitle: "Skriver ut",
    printingProgress: "{finished} av {total}",
    failedTitleOne: "Utskriften misslyckades",
    failedTitleMany: "Utskrifterna misslyckades",
    failedText: "Be en funktionär om hjälp.",
    failedProblems: "{problems} av {total} utskrifter misslyckades.",
    close: "Stäng",
    noPrinterTitle: "Ingen skrivare ansluten",
    noPrinterText:
      "Den här kiosken är inte ansluten till någon skrivare. Be en funktionär om hjälp.",
    noPrinterTextNamed:
      "Kiosken {kioskName} är inte ansluten till någon skrivare. Be en funktionär om hjälp.",
  },
  en: {
    printingTitle: "Printing",
    printingProgress: "{finished} of {total}",
    failedTitleOne: "The printout failed",
    failedTitleMany: "The printouts failed",
    failedText: "Ask a staff member at the check-in desk for help.",
    failedProblems: "{problems} of {total} printouts failed.",
    close: "Close",
    noPrinterTitle: "No printer connected",
    noPrinterText:
      "This kiosk is not connected to a printer. Ask a staff member for help.",
    noPrinterTextNamed:
      "The kiosk {kioskName} is not connected to a printer. Ask a staff member for help.",
  },
};

export function PrinterStatusScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

  const validPayload = Payload(payload);

  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  if (validPayload.state === "printing") {
    const { total, finished } = validPayload;
    return (
      <div className="flex flex-col gap-6 items-center">
        <h1 className="text-heading-base font-semibold">
          {t("printingTitle")}
        </h1>
        <ScoutLoader size="xl" />
        {total > 1 && (
          <p className="text-body-base">
            {t("printingProgress", { finished, total })}
          </p>
        )}
      </div>
    );
  }

  if (validPayload.state === "needs-help") {
    const { total, problems } = validPayload;
    return (
      <div className="flex flex-col gap-6">
        <ScoutCallout
          variant="warning"
          heading={total > 1 ? t("failedTitleMany") : t("failedTitleOne")}
        >
          <p>{t("failedText")}</p>
          {problems < total && (
            <p>{t("failedProblems", { problems, total })}</p>
          )}
        </ScoutCallout>

        <div className="flex justify-end">
          <ScoutButton
            variant="primary"
            onScoutClick={() =>
              socket?.send({
                name: "step:callMethod",
                data: { name: "acknowledge" },
              })
            }
          >
            {t("close")}
          </ScoutButton>
        </div>
      </div>
    );
  }

  const { kioskName } = validPayload;
  return (
    <ScoutCallout variant="error" heading={t("noPrinterTitle")}>
      <p>
        {kioskName
          ? t("noPrinterTextNamed", { kioskName })
          : t("noPrinterText")}
      </p>
    </ScoutCallout>
  );
}
