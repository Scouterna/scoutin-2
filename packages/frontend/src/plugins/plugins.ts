import type { ReactNode } from "react";

type ScreenConfig = {
  name: string;
  component: ({ payload }: { payload: object }) => ReactNode;
};

const screenRegistry: Record<string, ScreenConfig> = {};

function registerScreen(screenConfig: ScreenConfig) {
  screenRegistry[screenConfig.name] = screenConfig;
}

export const pluginSetupContext = {
  registerScreen,
};

export type PluginSetupContext = typeof pluginSetupContext;

export function findScreen(name: string): ScreenConfig | null {
  return screenRegistry[name] ?? null;
}
