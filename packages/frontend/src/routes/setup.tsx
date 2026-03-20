import {
  ScoutButton,
  ScoutCard,
  ScoutField,
  ScoutInput,
} from "@scouterna/ui-react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "@/api/api";

export const Route = createFileRoute("/setup")({
  beforeLoad: () => {
    if (localStorage.getItem("kioskKey")) {
      throw redirect({ to: "/" });
    }
  },
  component: SetupPage,
});

async function loadStyles() {
  await Promise.all([import("../kiosk-styles.css")]);
}

function SetupPage() {
  const [stylesLoaded, setStylesLoaded] = useState(false);
  loadStyles().finally(() => setStylesLoaded(true));

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (!stylesLoaded) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.kiosk.activate.$post({ json: { code, name } });
      if (!res.ok) {
        const data = await res.json();
        setError("error" in data ? data.error : "Activation failed");
        return;
      }
      const data = await res.json();
      localStorage.setItem("kioskKey", data.key);
      navigate({ to: "/" });
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  function handleCodeChange(value: string) {
    const stripped = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (stripped.length === 4 && code.replace("-", "").length === 3) {
      setCode(`${stripped}-`);
    } else {
      setCode(
        stripped.length <= 4
          ? stripped
          : `${stripped.slice(0, 4)}-${stripped.slice(4, 8)}`,
      );
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <ScoutCard>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
          <div>
            <h1 className="text-heading-base font-semibold">
              Konfigurera kiosk
            </h1>
            <p className="text-body-base text-gray-600">
              Ange aktiveringskoden från adminpanelen och ge den här kiosken ett
              namn.
            </p>
          </div>

          <ScoutField label="Aktiveringskod">
            <ScoutInput
              value={code}
              placeholder="XXXX-XXXX"
              onScoutInputChange={(e) => handleCodeChange(e.detail.value)}
            />
          </ScoutField>

          <ScoutField label="Namn på kiosken">
            <ScoutInput
              value={name}
              placeholder="T.ex. Kiosk 1 eller Kårens entré"
              onScoutInputChange={(e) => setName(e.detail.value)}
            />
          </ScoutField>

          {error && <p className="text-body-base text-red-600">{error}</p>}
          {loading && (
            <p className="text-body-base text-gray-600">Aktiverar…</p>
          )}

          <ScoutButton type="submit" variant="primary">
            Aktivera
          </ScoutButton>
        </form>
      </ScoutCard>
    </div>
  );
}
