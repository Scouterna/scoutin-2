import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import {
  buildValues,
  type Field,
  type FieldState,
  initialState,
  parseJson,
  schemaToFields,
  stateToJson,
  valuesToState,
} from "./templateForm";

/** The parts of a listed template that the values form needs. */
export type ValuesTemplate = {
  kind: "tsx" | "static" | "builtin";
  dpis?: number[];
  valuesSchema?: unknown;
};

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  const helper = field.required ? undefined : "valfritt";
  if (field.kind === "boolean") {
    return (
      <div>
        <FormControlLabel
          label={field.name}
          control={
            <Checkbox
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
            />
          }
        />
        {helper && (
          <FormHelperText sx={{ mt: -0.5, ml: 4 }}>{helper}</FormHelperText>
        )}
      </div>
    );
  }
  const text = typeof value === "string" ? value : "";
  if (field.kind === "enum") {
    return (
      <TextField
        select
        label={field.name}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        helperText={helper}
        required={field.required}
        fullWidth
      >
        {!field.required && <MenuItem value="">(ingen)</MenuItem>}
        {field.options?.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  const isNumber = field.kind === "number" || field.kind === "integer";
  return (
    <TextField
      label={field.name}
      type={isNumber ? "number" : "text"}
      // Text is multiline so Enter can put a newline in the value.
      multiline={!isNumber}
      minRows={isNumber ? undefined : 1}
      maxRows={isNumber ? undefined : 6}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      helperText={helper}
      required={field.required}
      slotProps={
        field.kind === "integer"
          ? { htmlInput: { step: 1 } }
          : field.kind === "number"
            ? { htmlInput: { step: "any" } }
            : undefined
      }
      fullWidth
    />
  );
}

function fieldsOf(template: ValuesTemplate | undefined) {
  if (!template) return { supported: false } as const;
  if (template.kind === "static") {
    return { supported: true, fields: [] as Field[] } as const;
  }
  return schemaToFields(template.valuesSchema);
}

/**
 * The editing state of a template's values: a form when the schema allows it,
 * JSON otherwise (or when asked for). Shared by the Print tab and the template
 * studio, which both also need to set the values from outside.
 */
export function useTemplateValues(template: ValuesTemplate | undefined) {
  const [fieldState, setFieldState] = useState<FieldState>({});
  const [jsonText, setJsonText] = useState("{}");
  const [wantJson, setWantJson] = useState(false);
  const [jsonNotice, setJsonNotice] = useState<string | null>(null);

  const isStatic = template?.kind === "static";
  const schemaResult = fieldsOf(template);
  const fields: Field[] = schemaResult.supported ? schemaResult.fields : [];
  const formPossible = schemaResult.supported;
  const jsonMode = !formPossible || wantJson;

  let values: unknown;
  let error: string | null = null;
  let valid = false;
  if (template) {
    if (isStatic) {
      values = {};
      valid = true;
    } else if (jsonMode) {
      const parsed = parseJson(jsonText);
      if (parsed.ok) {
        values = parsed.value;
        valid = true;
      } else {
        error = parsed.error;
      }
    } else {
      const built = buildValues(fields, fieldState);
      if (built.ok) {
        values = built.values;
        valid = true;
      } else {
        error = built.error;
      }
    }
  }
  const key = valid ? JSON.stringify(values) : null;

  /** Starts over for `next` (empty form, or an empty JSON object). */
  function reset(next: ValuesTemplate | undefined) {
    const result = next ? fieldsOf(next) : null;
    setFieldState(result?.supported ? initialState(result.fields) : {});
    setJsonText("{}");
    setJsonNotice(null);
    setWantJson(false);
  }

  /** Fills in `next` for `target` (the form if it fits, JSON if not). */
  function load(next: unknown, target: ValuesTemplate | undefined = template) {
    const result = target ? fieldsOf(target) : null;
    const state = result?.supported ? valuesToState(result.fields, next) : null;
    setJsonNotice(null);
    if (state) {
      setFieldState(state);
      setWantJson(false);
    } else {
      setJsonText(JSON.stringify(next ?? {}, null, 2));
      setWantJson(true);
    }
  }

  function toJson() {
    setJsonText(stateToJson(fields, fieldState));
    setJsonNotice(null);
    setWantJson(true);
  }

  function toForm() {
    const parsed = parseJson(jsonText);
    if (!parsed.ok) {
      setJsonNotice(`Kan inte visa som formulär: ${parsed.error}`);
      return;
    }
    const state = valuesToState(fields, parsed.value);
    if (!state) {
      setJsonNotice(
        "Kan inte visa som formulär: JSON-värdena matchar inte mallens fält.",
      );
      return;
    }
    setFieldState(state);
    setJsonNotice(null);
    setWantJson(false);
  }

  return {
    isStatic,
    fields,
    formPossible,
    jsonMode,
    fieldState,
    setFieldState,
    jsonText,
    setJsonText,
    jsonNotice,
    setJsonNotice,
    values,
    valid,
    error,
    key,
    reset,
    load,
    toJson,
    toForm,
  };
}

export type TemplateValuesState = ReturnType<typeof useTemplateValues>;

/** The values editor: a form, or JSON when the template can't be a form. */
export function TemplateValuesForm({
  template,
  state,
}: {
  template: ValuesTemplate;
  state: TemplateValuesState;
}) {
  const {
    isStatic,
    fields,
    formPossible,
    jsonMode,
    fieldState,
    setFieldState,
    jsonText,
    setJsonText,
    jsonNotice,
    setJsonNotice,
    error,
  } = state;
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">Värden</Typography>
      {isStatic ? (
        <Typography variant="body2" color="text.secondary">
          Finns för {(template.dpis ?? []).join(", ")} dpi
        </Typography>
      ) : (
        <>
          {!formPossible && (
            <Typography variant="body2" color="text.secondary">
              Mallen har värden som inte kan visas som formulär. Skriv dem som
              JSON.
            </Typography>
          )}
          {formPossible && fields.length === 0 && !jsonMode && (
            <Typography variant="body2" color="text.secondary">
              Mallen har inga värden.
            </Typography>
          )}
          {jsonMode ? (
            <TextField
              label="Värden (JSON)"
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonNotice(null);
              }}
              multiline
              minRows={6}
              error={error !== null}
              helperText={error ? `Ogiltig JSON: ${error}` : undefined}
              slotProps={{
                htmlInput: { style: { fontFamily: "monospace" } },
              }}
              fullWidth
            />
          ) : (
            fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={fieldState[field.name] ?? ""}
                onChange={(value) =>
                  setFieldState((s) => ({ ...s, [field.name]: value }))
                }
              />
            ))
          )}
          {jsonNotice && (
            <Typography variant="body2" color="error">
              {jsonNotice}
            </Typography>
          )}
          {formPossible && (
            <div>
              <Button
                size="small"
                onClick={jsonMode ? state.toForm : state.toJson}
              >
                {jsonMode ? "Visa som formulär" : "Visa som JSON"}
              </Button>
            </div>
          )}
        </>
      )}
    </Stack>
  );
}
