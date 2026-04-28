import type { MessageTypes } from "./messageTypes.ts";

type ConnectionSend = (message: MessageTypes) => void;
type ScreenData = { screenId: string; payload: object };

type StepMeta = { idInFlow?: string; evaluatedInputs?: Record<string, unknown> };

type SessionEntry = {
  connections: Set<ConnectionSend>;
  lastScreen: ScreenData | null;
  stepState: Record<string, unknown>;
  stepMeta: StepMeta | null;
};

const registry = new Map<string, SessionEntry>();

function getOrCreate(sessionId: string): SessionEntry {
  let entry = registry.get(sessionId);
  if (!entry) {
    entry = { connections: new Set(), lastScreen: null, stepState: {}, stepMeta: null };
    registry.set(sessionId, entry);
  }
  return entry;
}

export function getStepState(sessionId: string): Record<string, unknown> {
  return registry.get(sessionId)?.stepState ?? {};
}

export function setStepStateKey(
  sessionId: string,
  key: string,
  value: unknown,
): void {
  const entry = getOrCreate(sessionId);
  entry.stepState[key] = value;
}

export function clearStepState(sessionId: string): void {
  const entry = getOrCreate(sessionId);
  entry.stepState = {};
}

export function getStepMeta(sessionId: string): StepMeta | null {
  return registry.get(sessionId)?.stepMeta ?? null;
}

export function setStepMeta(sessionId: string, meta: StepMeta): void {
  getOrCreate(sessionId).stepMeta = meta;
}

/**
 * Send a message to all existing connections for a session then clear them.
 * Used for admin takeover: the kiosk receives the termination and disconnects.
 */
export function terminateExistingConnections(
  sessionId: string,
  message: MessageTypes,
): void {
  const entry = registry.get(sessionId);
  if (!entry) return;
  for (const send of entry.connections) {
    try {
      send(message);
    } catch {
      // Ignore dead connections
    }
  }
  entry.connections.clear();
}

/** Register a WS connection for a session. Returns an unregister function. */
export function registerConnection(
  sessionId: string,
  send: ConnectionSend,
): () => void {
  const entry = getOrCreate(sessionId);
  entry.connections.add(send);
  return () => entry.connections.delete(send);
}

export function getConnectionCount(sessionId: string): number {
  return registry.get(sessionId)?.connections.size ?? 0;
}

export function getLastScreen(sessionId: string): ScreenData | null {
  return registry.get(sessionId)?.lastScreen ?? null;
}

/**
 * Broadcast a message to all registered connections for a session.
 * Connections that throw on send are automatically removed.
 */
export function broadcastToSession(
  sessionId: string,
  message: MessageTypes,
): void {
  const entry = registry.get(sessionId);
  if (!entry) return;

  const dead: ConnectionSend[] = [];
  for (const send of entry.connections) {
    try {
      send(message);
    } catch {
      dead.push(send);
    }
  }
  for (const send of dead) entry.connections.delete(send);
}

/**
 * Returns a minimal ws-like object whose send broadcasts to all connections
 * for the session. Also tracks the last showScreen for late joiners.
 */
export function createBroadcastWs(sessionId: string): {
  send(message: MessageTypes): void;
} {
  return {
    send(message: MessageTypes) {
      if (message.name === "step:showScreen") {
        getOrCreate(sessionId).lastScreen = (
          message as Extract<MessageTypes, { name: "step:showScreen" }>
        ).data;
      }
      broadcastToSession(sessionId, message);
    },
  };
}
