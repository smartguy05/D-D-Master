/** Tiny JSON client for the server's REST API. Throws Error(message) on { error }. */
export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects when no response arrived ("Failed to fetch"): the server is down or unreachable.
    throw new Error("Can't reach the game server. Is it running? (pnpm dev)");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export const del = (path: string) => api(path, undefined, "DELETE");
export const patch = (path: string, body: unknown) => api(path, body, "PATCH");
export const put = (path: string, body: unknown) => api(path, body, "PUT");
