import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";

export class StepRegistry {
  private steps: Map<string, StepImplementation>;

  constructor() {
    this.steps = new Map<string, StepImplementation>();
  }

  register(implementation: StepImplementation) {
    if (this.steps.has(implementation.id)) {
      throw new Error(
        `Step with ID "${implementation.id}" is already registered.`,
      );
    }
    // Skipping a step on the way back and refusing to go back past it
    // contradict each other.
    if (implementation.skipOnGoBack && implementation.preventGoBack) {
      throw new Error(
        `Step "${implementation.id}" can't be both skipOnGoBack and preventGoBack.`,
      );
    }
    this.steps.set(implementation.id, implementation);
  }

  get(stepId: string): StepImplementation | null {
    const implementation = this.steps.get(stepId);
    return implementation ?? null;
  }
}
