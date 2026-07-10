import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";

export class EnricherRegistry {
  private enrichers: Map<string, ImportEnricher>;

  constructor() {
    this.enrichers = new Map<string, ImportEnricher>();
  }

  register(enricher: ImportEnricher) {
    if (this.enrichers.has(enricher.name)) {
      throw new Error(
        `Import enricher with name "${enricher.name}" is already registered.`,
      );
    }
    this.enrichers.set(enricher.name, enricher);
  }

  get(name: string): ImportEnricher | null {
    const enricher = this.enrichers.get(name);
    return enricher ?? null;
  }
}
