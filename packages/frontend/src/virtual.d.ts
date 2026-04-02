declare module "virtual:scoutin-plugins" {
  import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api";
  const plugins: FrontendPlugin[];
  export default plugins;
}
