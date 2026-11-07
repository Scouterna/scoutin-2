declare module "*?raw" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_SCANNER_MARKERS?: string;
  readonly VITE_SCANNER_ENTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
