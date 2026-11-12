import { ScoutButton, ScoutCard } from "@scouterna/ui-react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";
import { api } from "@/api/api";
import { printerStateLabels } from "@/components/admin/printing/printerStateLabels";
import {
  currentScreenAtom,
  sessionCredentialsAtom,
  sessionInfoAtom,
} from "@/store/session";
import { socketAtom } from "@/store/socket";
import { createTapCounter } from "./tapCounter";

type KioskInfo = {
  name: string;
  printPool: {
    name: string;
    queued: number;
    printers: { serial: string; name: string | null; state: string }[];
  } | null;
};

class KioskNotRegisteredError extends Error {}

const TAPS_TO_OPEN = 10;
const TAP_WINDOW_MS = 3000;
const HIT_AREA_CLASS = "fixed top-0 right-0 w-16 h-16 z-[60] select-none";

async function fetchKioskInfo(): Promise<KioskInfo> {
  const key = localStorage.getItem("kioskKey") ?? "";
  const res = await api.kiosk.me.$get(
    {},
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (res.status === 401) throw new KioskNotRegisteredError();
  return res.json();
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-200">
      <dt className="font-semibold">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function InfoSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <h3 className="text-body-lg font-semibold text-blue-700">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

/**
 * Hidden, read-only diagnostics for staff. Ten quick taps in the top-right
 * corner open it. It only reads state and offers a reload and a close button.
 */
export function KioskInfoMenu() {
  const [open, setOpen] = useState(false);
  const [counter] = useState(() =>
    createTapCounter({ taps: TAPS_TO_OPEN, windowMs: TAP_WINDOW_MS }),
  );

  const socket = useAtomValue(socketAtom);
  const session = useAtomValue(sessionCredentialsAtom);
  const sessionInfo = useAtomValue(sessionInfoAtom);
  const screen = useAtomValue(currentScreenAtom);

  const me = useQuery({
    queryKey: ["kiosk", "me"],
    queryFn: fetchKioskInfo,
    enabled: open,
    staleTime: 0,
    retry: false,
  });

  let kioskName: string;
  let printRows: ReactNode;
  if (me.isPending) {
    kioskName = "Hämtar...";
    printRows = <InfoRow label="Skrivarpool">Hämtar...</InfoRow>;
  } else if (me.error instanceof KioskNotRegisteredError) {
    kioskName = "Kiosken är inte registrerad längre";
    printRows = <InfoRow label="Skrivarpool">—</InfoRow>;
  } else if (me.error) {
    kioskName = "Kunde inte hämta kioskinformation";
    printRows = <InfoRow label="Skrivarpool">—</InfoRow>;
  } else {
    kioskName = me.data.name;
    const pool = me.data.printPool;
    printRows = pool ? (
      <>
        <InfoRow label="Skrivarpool">{pool.name}</InfoRow>
        <InfoRow label="I kö">{pool.queued}</InfoRow>
        {pool.printers.length === 0 ? (
          <InfoRow label="Skrivare">Inga skrivare i poolen</InfoRow>
        ) : (
          pool.printers.map((printer) => (
            <InfoRow
              key={printer.serial}
              label={printer.name ?? printer.serial}
            >
              {printerStateLabels[printer.state] ?? printer.state}
            </InfoRow>
          ))
        )}
      </>
    ) : (
      <InfoRow label="Skrivarpool">Ingen vald</InfoRow>
    );
  }

  return (
    <>
      {!open && (
        <div
          aria-hidden="true"
          className={HIT_AREA_CLASS}
          onPointerDown={() => {
            if (counter.tap()) setOpen(true);
          }}
        />
      )}

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 select-none">
          <div className="w-4xl max-w-[calc(100vw-2rem)]">
            <ScoutCard>
              <div className="p-4">
                <h2 className="text-heading-lg font-semibold mb-4">
                  Kioskinformation
                </h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                  <InfoSection title="Kiosk">
                    <InfoRow label="Namn">{kioskName}</InfoRow>
                    <InfoRow label="Version">
                      {import.meta.env.VITE_APP_VERSION ?? "dev"}
                    </InfoRow>
                  </InfoSection>
                  <InfoSection title="Session">
                    {session ? (
                      <>
                        <InfoRow label="ID">{session.id}</InfoRow>
                        <InfoRow label="Skärm">
                          {screen?.screenId ?? "—"}
                        </InfoRow>
                        <InfoRow label="Incheckare">
                          {sessionInfo?.actor
                            ? `${sessionInfo.actor.firstName} ${sessionInfo.actor.lastName} (${sessionInfo.actor.idInDataSource})`
                            : "—"}
                        </InfoRow>
                      </>
                    ) : (
                      <InfoRow label="ID">Ingen pågående session</InfoRow>
                    )}
                  </InfoSection>
                  <InfoSection title="Anslutning">
                    <InfoRow label="Server">{window.location.origin}</InfoRow>
                    <InfoRow label="Status">
                      {socket ? "Ansluten" : "Inte ansluten"}
                    </InfoRow>
                  </InfoSection>
                  <InfoSection title="Skrivare">{printRows}</InfoSection>
                </div>

                <div className="flex gap-4 justify-end mt-4">
                  <ScoutButton
                    variant="outlined"
                    onClick={() => {
                      setOpen(false);
                    }}
                  >
                    Stäng
                  </ScoutButton>
                  <ScoutButton
                    variant="primary"
                    onClick={() => {
                      window.location.reload();
                    }}
                  >
                    Ladda om
                  </ScoutButton>
                </div>
              </div>
            </ScoutCard>
          </div>
        </div>
      )}
    </>
  );
}
