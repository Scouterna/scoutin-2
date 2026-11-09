import {
  listStepConfigs,
  prisma,
  recordAudit,
} from "@scouterna/scoutin-backend/plugin-services";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { createVoteitClient, type Invite, inviteMemberId } from "./client.ts";

const SCREEN = "voteit:status";
const ROLE = "pv";

const Inputs = type({ participantId: "string" });
type Inputs = typeof Inputs.infer;

const Outputs = type({
  status: "'granted' | 'alreadyGranted' | 'skipped'",
  "invitePk?": "number",
});

type Reason = "notInvited" | "ambiguous" | "error";

type State = {
  attempt?:
    | { status: "working" }
    | {
        status: "granted";
        result: "granted" | "alreadyGranted";
        invitePk: number;
      }
    | { status: "failed"; reason: Reason; error: string };
};

type Ctx = StepMethodContext<State>;

type Granted = {
  status: "granted" | "alreadyGranted";
  invite: Invite;
  rolesBefore: string[];
  rolesAfter: string[];
};

class AttemptFailed extends Error {
  constructor(
    readonly reason: Reason,
    message: string,
  ) {
    super(message);
  }
}

function readConfig() {
  // biome-ignore lint/style/noProcessEnv: plugin-specific settings, read when the step runs
  const { VOTEIT_BASE_URL: baseUrl, VOTEIT_API_KEY: apiKey } = process.env;
  return { baseUrl, apiKey };
}

function getClient() {
  const { baseUrl, apiKey } = readConfig();
  if (!baseUrl || !apiKey) {
    throw new Error("VOTEIT_BASE_URL and VOTEIT_API_KEY must be set");
  }
  return createVoteitClient({ baseUrl, apiKey });
}

async function loadMemberId(participantId: string): Promise<string> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { idInDataSource: true },
  });
  if (!participant) throw new Error(`Participant ${participantId} not found`);
  return participant.idInDataSource;
}

function checkResponse(before: Invite, after: Invite, memberId: string) {
  const ok =
    after.pk === before.pk &&
    inviteMemberId(after) === memberId &&
    after.roles.includes(ROLE) &&
    before.roles.every((role) => after.roles.includes(role));

  if (!ok) {
    throw new AttemptFailed(
      "error",
      `VoteIT response for member ${memberId} failed the safety check`,
    );
  }
}

async function grant(memberId: string): Promise<Granted> {
  const client = getClient();
  const invites = await client.findInvites(memberId);
  if (invites.length === 0) {
    throw new AttemptFailed("notInvited", "No open or accepted invite found");
  }
  if (invites.length > 1) {
    throw new AttemptFailed("ambiguous", "More than one invite found");
  }
  const invite = invites[0];
  if (invite.roles.includes(ROLE)) {
    return {
      status: "alreadyGranted",
      invite,
      rolesBefore: invite.roles,
      rolesAfter: invite.roles,
    };
  }
  const updated = await client.addVoterRole(invite);
  checkResponse(invite, updated, memberId);
  return {
    status: "granted",
    invite: updated,
    rolesBefore: invite.roles,
    rolesAfter: updated.roles,
  };
}

async function attempt(ctx: Ctx) {
  const { participantId } = ctx.getInputs() as Inputs;
  ctx.setState("attempt", { status: "working" });
  await ctx.showScreen(SCREEN, { state: "working" });

  let memberId: string | undefined;
  try {
    memberId = await loadMemberId(participantId);
    const result = await grant(memberId);
    const at = new Date().toISOString();
    await recordAudit({
      actor: null,
      action: `voteit.${result.status === "granted" ? "grant" : "alreadyGranted"}`,
      details: {
        sessionId: ctx.sessionId,
        participantId,
        memberId,
        invitePk: result.invite.pk,
        rolesBefore: result.rolesBefore,
        rolesAfter: result.rolesAfter,
      },
    });
    await ctx.writeResultData(participantId, {
      status: result.status,
      invitePk: result.invite.pk,
      at,
    });
    ctx.setState("attempt", {
      status: "granted",
      result: result.status,
      invitePk: result.invite.pk,
    });
    await ctx.showScreen(SCREEN, { state: "granted", result: result.status });
  } catch (error) {
    const reason = error instanceof AttemptFailed ? error.reason : "error";
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger.warn(
      { participantId, memberId, reason },
      `VoteIT grant failed for member ${memberId ?? "unknown"} (${reason}): ${message}`,
    );
    ctx.setState("attempt", { status: "failed", reason, error: message });
    await ctx.showScreen(SCREEN, { state: "failed", reason });
  }
}

export const grantVoterRoleStep: StepImplementation<State> = {
  id: "voteit:grantVoterRole",
  preventGoBack: true,
  inputs: Inputs,
  outputs: Outputs,
  hooks: {
    async onStepStart(ctx) {
      await attempt(ctx);
    },
  },
  publicMethods: {
    retry: {
      async handler(ctx) {
        // Ignore a double press or a stale call: only a failed step may retry.
        if (ctx.getState("attempt")?.status !== "failed") return;
        await attempt(ctx);
      },
    },
    continue: {
      async handler(ctx) {
        // Ignore a double press or a stale call: only a granted step may continue.
        const granted = ctx.getState("attempt");
        if (granted?.status !== "granted") return;
        ctx.setState("attempt", { status: "working" });
        await ctx.setCompleted({
          status: granted.result,
          invitePk: granted.invitePk,
        });
      },
    },
    skip: {
      async handler(ctx) {
        const failed = ctx.getState("attempt");
        if (failed?.status !== "failed") return;
        ctx.setState("attempt", { status: "working" });
        const { participantId } = ctx.getInputs() as Inputs;
        const { reason, error } = failed;
        let memberId: string | null = null;
        try {
          memberId = await loadMemberId(participantId);
        } catch {
          // The audit row is still worth writing without the number.
        }
        await recordAudit({
          actor: null,
          action: "voteit.skip",
          details: {
            sessionId: ctx.sessionId,
            participantId,
            memberId,
            reason,
            error,
          },
        });
        await ctx.writeResultData(participantId, {
          status: "skipped",
          reason,
          at: new Date().toISOString(),
        });
        await ctx.setCompleted({ status: "skipped" });
      },
    },
  },
};

/**
 * Startup check: a step config that uses a voteit: step needs the base URL and
 * the key, so a missing variable fails at deploy time and not at the first check-in.
 */
export async function checkConfig(): Promise<void> {
  const { baseUrl, apiKey } = readConfig();
  if (baseUrl && apiKey) return;
  for (const { file, config } of await listStepConfigs()) {
    if (config.steps.some((step) => step.uses.startsWith("voteit:"))) {
      throw new Error(
        `${file} uses a voteit: step but VOTEIT_BASE_URL and VOTEIT_API_KEY are not both set`,
      );
    }
  }
}
