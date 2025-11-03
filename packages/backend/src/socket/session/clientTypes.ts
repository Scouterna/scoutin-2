export type Auth = {
  name: "auth";
  token: string;
};

export type Heartbeat = {
  name: "heartbeat";
};

export type ClientMessage = Auth | Heartbeat;
