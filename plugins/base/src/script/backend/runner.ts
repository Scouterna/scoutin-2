import vm from "node:vm";

export type ScriptRunner = (args: {
  code: string;
  variables: Record<string, unknown>;
}) => unknown;

const TIMEOUT_MS = 1000;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// node:vm is not a security boundary; the script is trusted deploy-time config.
export const runScript: ScriptRunner = ({ code, variables }) => {
  for (const name of Object.keys(variables)) {
    if (!IDENTIFIER.test(name)) {
      throw new Error(
        `Invalid variable name "${name}": not a valid identifier`,
      );
    }
  }

  const context = vm.createContext(structuredClone(variables), {
    codeGeneration: { strings: false, wasm: false },
  });

  let raw: unknown;
  try {
    // The wrapped call is the script's execution, so the timeout covers it.
    raw = vm.runInContext(`(function () { ${code}\n})()`, context, {
      timeout: TIMEOUT_MS,
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      throw new Error(`Script timed out after ${TIMEOUT_MS} ms`);
    }
    // Errors thrown inside the context come from another realm, so no instanceof.
    const message = (error as { message?: unknown })?.message;
    throw new Error(typeof message === "string" ? message : String(error));
  }

  if (raw === undefined) {
    throw new Error("Script returned undefined; it must return a JSON value");
  }

  let json: string | undefined;
  try {
    json = JSON.stringify(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Script result is not JSON-serializable: ${message}`);
  }
  if (json === undefined) {
    throw new Error("Script result is not JSON-serializable");
  }
  return JSON.parse(json);
};
