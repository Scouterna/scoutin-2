import { type } from "arktype";

const Invite = type({
  pk: "number",
  state: "string",
  user_data: "Record<string, unknown>",
  roles: "string[]",
});
export type Invite = typeof Invite.infer;

export type VoteitClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
};

const Invites = Invite.array();

const TIMEOUT_MS = 10_000;
// Room for any DRF validation message; keeps an HTML error page out of logs.
const MAX_BODY_CHARS = 2000;

/** Built from method, path, status and body only; never the key or headers. */
export class VoteitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoteitError";
  }
}

/** The one place that knows where the membership number sits on an invite. */
export function inviteMemberId(invite: Invite): string | undefined {
  const value = invite.user_data.member_id;
  return typeof value === "string" ? value : undefined;
}

export function createVoteitClient({
  baseUrl,
  apiKey,
  fetch = globalThis.fetch,
}: VoteitClientOptions) {
  async function request(
    method: "GET" | "POST",
    url: URL,
    body?: unknown,
  ): Promise<unknown> {
    const path = url.pathname + url.search;
    const headers: Record<string, string> = {
      Authorization: `Api-Key ${apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown error";
      throw new VoteitError(`${method} ${path} failed: ${reason}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new VoteitError(
        `${method} ${path} returned ${response.status}: ${text.slice(0, MAX_BODY_CHARS)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new VoteitError(`${method} ${path} returned invalid JSON`);
    }
  }

  function validate<T>(
    result: T | InstanceType<typeof type.errors>,
    what: string,
  ): T {
    if (result instanceof type.errors) {
      throw new VoteitError(`Unexpected ${what} response: ${result.summary}`);
    }
    return result;
  }

  return {
    async findInvites(memberId: string): Promise<Invite[]> {
      const url = new URL("/token-api/invites/", baseUrl);
      url.search = new URLSearchParams({
        member_id: memberId,
        state: "open,accepted",
      }).toString();
      return validate(Invites(await request("GET", url)), "invite list");
    },

    /** Takes the invite VoteIT returned, so the pk always comes from VoteIT. */
    async addVoterRole(invite: Invite): Promise<Invite> {
      const url = new URL(
        `/token-api/invites/${invite.pk}/add-roles/`,
        baseUrl,
      );
      return validate(
        Invite(await request("POST", url, { roles: ["pv"] })),
        "invite",
      );
    },
  };
}
