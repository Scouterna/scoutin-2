import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import { stepCompletions } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import { sendSessionInfo } from "../../domains/sessions/session.service.ts";
import {
  completeStep,
  finalizeSession,
  getCurrentStep,
} from "../../domains/workflows/step.service.ts";
import { getLogger, logger } from "../logging/logger.ts";
import type { MessageTypes } from "../websocket/messageTypes.ts";
import {
  clearStepState,
  createBroadcastWs,
  getStepMeta,
  getStepState,
  markScreenShown,
  registerConnection,
  setStepStateKey,
  wasScreenShown,
} from "../websocket/sessionRegistry.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
import type { TypedContext } from "../websocket/types.ts";
import { restartStep, startStep } from "./step.ts";

export function createStepContext(
  c: TypedContext,
  ws: TypedWSContext<MessageTypes>,
  stepImplementation: StepImplementation,
): StepMethodContext {
  const sessionId = c.get("wsSessionId");
  if (!sessionId) {
    throw new Error("No session ID found in context");
  }

  return {
    sessionId,
    logger: getLogger(c),
    async sendMessage(name, payload = {}) {
      ws.send({
        name: "step:message",
        data: { name, payload },
      });
    },
    async setCompleted(outputs: Record<string, unknown> = {}) {
      // TODO: This method is doing too much.
      let validatedOutputs: Record<string, unknown> = {};

      if (stepImplementation.outputs) {
        const validationResult =
          await stepImplementation.outputs["~standard"].validate(outputs);

        if (validationResult.issues) {
          throw new Error(
            `Invalid outputs for step "${stepImplementation.id}": ${JSON.stringify(
              validationResult.issues,
            )}`,
          );
        }

        validatedOutputs = validationResult.value;
      }

      // Re-read session ID from context to respect any overrideSession() call.
      const effectiveSessionId = c.get("wsSessionId") ?? sessionId;

      // stepMeta was stored for the original session; fall back if overridden.
      const stepMeta =
        getStepMeta(effectiveSessionId) ?? getStepMeta(sessionId);
      if (!stepMeta) {
        throw new Error("No step metadata found in context");
      }

      stepCompletions.inc({ step_id: stepImplementation.id });

      await completeStep(
        effectiveSessionId,
        stepImplementation.id,
        stepMeta.idInFlow,
        stepMeta.evaluatedInputs,
        validatedOutputs,
        !wasScreenShown(sessionId),
      );

      // The incoming `ws` is a broadcaster bound to the session id captured
      // when this step method started. If the step called overrideSession()
      // (e.g. resuming a previous check-in), that handle now targets the wrong
      // session and its messages would reach no one. Rebuild the broadcaster
      // for the effective session so screen updates actually reach the kiosk.
      const effectiveWs =
        effectiveSessionId === sessionId
          ? ws
          : (createBroadcastWs(
              effectiveSessionId,
            ) as unknown as TypedWSContext<MessageTypes>);

      const currentStep = await getCurrentStep(effectiveSessionId);
      if (currentStep === null) {
        await finalizeSession(effectiveSessionId);
        effectiveWs.send({ name: "session:completed" });
        return;
      }
      await startStep(c, effectiveWs, currentStep);
    },
    getInputs() {
      const stepMeta = getStepMeta(sessionId);
      return stepMeta?.evaluatedInputs ?? {};
    },
    setState(key, value) {
      setStepStateKey(sessionId, key, value);
    },
    getState(key) {
      return getStepState(sessionId)[key];
    },
    clearState() {
      clearStepState(sessionId);
    },
    async showScreen(screenId, payload = {}) {
      markScreenShown(sessionId);
      ws.send({
        name: "step:showScreen",
        data: { screenId, payload },
      });
    },
    async setActor(options) {
      if ("administrator" in options) {
        throw new Error("Setting administrator actor is not implemented yet");
      }

      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      await prisma.checkinActor.create({
        data: {
          sessionId,
          participantId: options.participantId,
        },
      });

      await sendSessionInfo(sessionId, ws);
    },
    async clearActor() {
      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      // `delete()` throws if no record is found, which would be OK in our case.
      // `deleteMany()` doesn't throw so we use that instead.
      // https://github.com/prisma/prisma/discussions/21682#discussioncomment-7425337
      await prisma.checkinActor.deleteMany({ where: { sessionId } });
    },
    async getActor() {
      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      const actor = await prisma.checkinActor.findUnique({
        where: { sessionId },
        include: { participant: true },
      });

      if (!actor) return null;

      if (!actor.participantId || !actor.participant) {
        throw new Error(`Actor for session ${sessionId} has no participant ID`);
      }

      return {
        actor: {
          id: actor.id,
        },
        participant: {
          id: actor.participantId,
          firstName: actor.participant.firstName,
          lastName: actor.participant.lastName,
          dataSource: actor.participant.dataSource,
        },
      };
    },
    async setSubjects({ participantIds }) {
      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      const existingSubjects = await prisma.checkinSubject.findMany({
        where: { checkinSessionId: sessionId },
      });

      if (existingSubjects.length > 0) {
        // TODO: Can we handle this gracefully? We could delete old subjects and
        // set new ones, but that could have unintended consequences. Maybe we
        // should just let the user start a new session?
        throw new Error(
          "Subjects have already been set for this session, cannot set again",
        );
      }

      await prisma.checkinSubject.createMany({
        data: participantIds.map((participantId) => ({
          checkinSessionId: sessionId,
          participantId,
        })),
      });
    },
    async clearSubjects() {
      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      await prisma.checkinSubject.deleteMany({
        where: { checkinSessionId: sessionId },
      });
    },
    async overrideSession(newSessionId) {
      const oldSessionId = c.get("wsSessionId");

      // Move this live WebSocket connection to the new session in the
      // registry. Connections are keyed by session id, and all screen updates
      // are broadcast per session id — without re-registering here, every
      // message for the new session (goBack, step advancement, showScreen)
      // would be broadcast to a session that has no connections and silently
      // dropped, freezing the kiosk. See sessionRegistry / step.ts.
      if (oldSessionId && oldSessionId !== newSessionId) {
        const send = c.get("wsSend");
        if (send) {
          c.get("wsUnregister")?.();
          c.set("wsUnregister", registerConnection(newSessionId, send));
        }
      }

      c.set("wsSessionId", newSessionId);
      c.set(
        "logger",
        logger.child({ connId: c.get("connId"), sessionId: newSessionId }),
      );
    },
    async restartStep() {
      await restartStep(c, ws);
    },
  };
}
