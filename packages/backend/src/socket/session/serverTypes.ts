export type ServerAuth = {
  name: "auth";
} & (
  | {
      status: "success";
    }
  | {
      status: "failure";
      reason: string;
    }
);

export type ServerMessage = ServerAuth;
