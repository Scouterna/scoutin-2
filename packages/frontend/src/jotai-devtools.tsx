import { DevTools } from "jotai-devtools";
import css from "jotai-devtools/styles.css?inline";

export const JotaiDevTools = () =>
  // biome-ignore lint/style/noProcessEnv: This is the one variable that's probably OK to use like this.
  process.env.NODE_ENV !== "production" ? (
    <>
      <style>{css}</style>
      <style>
        {`
          #jotai-devtools-root {
            --mantine-scale: 2/3 !important;
          }
        `}
      </style>
      <DevTools />
    </>
  ) : null;
