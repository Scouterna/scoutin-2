import { describe, expect, it, vi } from "vitest";
import { createVoteitClient, inviteMemberId, VoteitError } from "./client.ts";

const invite = {
  pk: 7,
  state: "open",
  user_data: { member_id: "3001" },
  roles: ["pa"],
  extra: true,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function setup(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  const client = createVoteitClient({
    baseUrl: "https://v.example",
    apiKey: "SECRET-KEY",
    fetch,
  });
  return { fetch, client };
}

describe("voteit client", () => {
  it("finds invites by member id", async () => {
    const { fetch, client } = setup(json([invite]));
    expect(await client.findInvites("3001")).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://v.example/token-api/invites/?member_id=3001&state=open%2Caccepted",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Api-Key SECRET-KEY");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("adds the voter role by the invite's pk", async () => {
    const { fetch, client } = setup(json({ ...invite, roles: ["pa", "pv"] }));
    const result = await client.addVoterRole(invite);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://v.example/token-api/invites/7/add-roles/",
    );
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ roles: ["pv"] });
    expect(result.roles).toContain("pv");
  });

  it("reads the member id through the accessor", () => {
    expect(inviteMemberId(invite)).toBe("3001");
    expect(inviteMemberId({ ...invite, user_data: { member_id: 5 } })).toBe(
      undefined,
    );
  });

  it("builds errors from status and truncated body, without the key", async () => {
    const { client } = setup(new Response("x".repeat(5000), { status: 403 }));
    const error = await client.findInvites("3001").catch((e) => e);
    expect(error).toBeInstanceOf(VoteitError);
    expect(error.message).toContain("GET /token-api/invites/");
    expect(error.message).toContain("403");
    expect(error.message.length).toBeLessThan(2200);
    expect(error.message).not.toContain("SECRET-KEY");
  });

  it("rejects a response of the wrong shape", async () => {
    const { client } = setup(json([{ pk: "1" }]));
    await expect(client.findInvites("3001")).rejects.toBeInstanceOf(
      VoteitError,
    );
  });

  it("does not leak the key when the request itself fails", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("boom SECRET-KEY"));
    const client = createVoteitClient({
      baseUrl: "https://v.example",
      apiKey: "SECRET-KEY",
      fetch,
    });
    const error = await client.findInvites("1").catch((e) => e);
    expect(error.message).not.toContain("SECRET-KEY");
  });
});
