import type { StepImplementation } from "./stepImplementation.ts";

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
    this.steps.set(implementation.id, implementation);
  }

  get(stepId: string): StepImplementation | null {
    const implementation = this.steps.get(stepId);
    return implementation ?? null;
  }
}
