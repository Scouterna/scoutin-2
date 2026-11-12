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
// The "working" screen shows at least this long, so a fast answer doesn't make
// it blink past before the next screen.
const MIN_WORKING_MS = 2000;
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
  const minWorking = new Promise((resolve) =>
    setTimeout(resolve, MIN_WORKING_MS),
  );

  let memberId: string | undefined;
  let result: Granted;
  try {
    memberId = await loadMemberId(participantId);
    result = await grant(memberId);
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
  } catch (error) {
    const reason = error instanceof AttemptFailed ? error.reason : "error";
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger.warn(
      { participantId, memberId, reason },
      `VoteIT grant failed for member ${memberId ?? "unknown"} (${reason}): ${message}`,
    );
    await minWorking;
    ctx.setState("attempt", { status: "failed", reason, error: message });
    await ctx.showScreen(SCREEN, { state: "failed", reason });
    return;
  }

  // Granted: go straight on, so the badge prints without waiting for a tap.
  // Outside the try, so an error from the next step isn't reported as a
  // VoteIT failure.
  await minWorking;
  await ctx.setCompleted({ status: result.status, invitePk: result.invite.pk });
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
    skip: {
      async handler(ctx) {
        // Staff only: the kiosk sends the delegate to the desk instead. The
        // screen hides the button on the kiosk, but any client can send a
        // method call, so check here too.
        if (ctx.role !== "staff") {
          ctx.logger.warn("Ignoring VoteIT skip from a non-staff client");
          return;
        }
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
