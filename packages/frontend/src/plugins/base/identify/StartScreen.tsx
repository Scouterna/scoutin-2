import { ScoutButton, ScoutField, ScoutInput } from "@scouterna/ui-react";
import { useAtomValue } from "jotai";
import { socketAtom } from "@/store/socket";

export function StartScreen() {
  const socket = useAtomValue(socketAtom);

  const onNextClick = () => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "dummy",
        inputs: {},
      },
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
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

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
      <ScoutField label="Person- eller medlemsnummer">
        <ScoutInput
          name="query"
          validate={(value) =>
            value.length === 0 ? "Fältet får inte vara tomt" : null
          }
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
