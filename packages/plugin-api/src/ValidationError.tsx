import type { ArkErrors } from "arktype";

export type Props = {
  errors: ArkErrors;
};

export function ValidationError({ errors }: Props) {
  return (
    <div className="p-4 bg-red-100 text-red-800 rounded">
      <h2 className="font-bold mb-2">Valideringsfel</h2>
      <pre className="whitespace-pre-wrap">
        {JSON.stringify(errors, null, 2)}
      </pre>
    </div>
  );
}
