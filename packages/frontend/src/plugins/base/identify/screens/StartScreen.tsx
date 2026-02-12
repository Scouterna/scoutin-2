import { ScoutButton, ScoutField, ScoutInput } from "@scouterna/ui-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { socketAtom } from "@/store/socket";

export function StartScreen() {
  const socket = useAtomValue(socketAtom);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const valid = e.currentTarget.checkValidity();
    if (!valid) {
      return;
    }

    const formData = new FormData(e.currentTarget);
    const query = formData.get("query") as string;

    socket?.send({
      name: "step:callMethod",
      data: {
        name: "searchByString",
        inputs: { query },
      },
    });
  };

  const [scoutInputValidity, setScoutInputValidity] = useState("");

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-2">
      <ScoutField label="Person- eller medlemsnummer">
        <ScoutInput
          name="query"
          value="3192927"
          validity={scoutInputValidity}
          onScoutValidate={(e) => {
            if (e.detail.value.length === 0) {
              setScoutInputValidity("Fältet får inte vara tomt");
            } else {
              setScoutInputValidity("");
            }
          }}
        />
      </ScoutField>

      <div>
        <ScoutButton type="submit" variant="primary">
          Skicka
        </ScoutButton>
      </div>
    </form>
  );
}
