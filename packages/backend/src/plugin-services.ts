/**
 * Services exported for use by backend plugins running in the monorepo.
 *
 * Note: these imports couple plugins to the host backend. When plugins are
 * extracted to standalone packages, the services they need should instead be
 * injected via BackendPluginContext. Prisma has complex query types that might
 * be hard to replicate. We might be better off just bundling those original
 * types with the plugin API.
 */

export { prisma } from "./app/prisma.ts";
export { evaluateExpression } from "./core/expressions/expressions.ts";
export { withStepContext } from "./core/workflow/withStepContext.ts";
export { isBlocked } from "./domains/blocklist/blocklist.service.ts";
export {
  dataSourceConfig,
  findParticipantsByLookupValue,
  getSubjectCandidates,
  hasImportErrors,
  NO_IMPORT_ERROR_WHERE,
  normalizeIdentifier,
} from "./domains/participants/data.service.ts";
export {
  createJobsForStep,
  isFinishedJobState,
  listJobsForStep,
  onJobFinished,
  parseStepJobKey,
} from "./domains/printing/step-print.service.ts";
export { getTemplate } from "./domains/printing/templates.service.ts";
export { listStepConfigs } from "./domains/workflows/step.service.ts";
export type { Participant } from "./generated/prisma/client.ts";
