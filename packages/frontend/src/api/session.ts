import { api } from "./api";

export { ws } from "./api";

export async function create() {
  const res = await api.session.$post();
  return await res.json();
}
