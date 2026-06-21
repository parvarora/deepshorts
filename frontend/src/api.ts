// Typed client for the FastAPI backend. One module, every endpoint, clean error surface.
import type {
  GenerateRequest,
  GenerateResponse,
  Options,
  RegenerateRequest,
  Script,
  TraceStep,
} from "./types";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string) || "http://localhost:8000";

export class ApiError extends Error {
  kind: string;
  constructor(message: string, kind = "server") {
    super(message);
    this.kind = kind;
  }
}

async function parseError(res: Response): Promise<never> {
  let kind = "server";
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
    if (body?.kind) kind = body.kind;
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(message, kind);
}

export async function getOptions(): Promise<Options> {
  const res = await fetch(`${API_BASE}/api/options`);
  if (!res.ok) return parseError(res);
  return res.json();
}

export async function health(): Promise<{ status: string; has_api_key: boolean; model: string }> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) return parseError(res);
  return res.json();
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) return parseError(res);
  return res.json();
}

export async function regenerate(req: RegenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/api/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) return parseError(res);
  return res.json();
}

// Resolve a director image path returned by /api/options to an absolute URL.
export function imageUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

export interface StreamHandlers {
  onStep: (node: string, trace: TraceStep) => void;
  onResult: (script: Script, meta: GenerateResponse["meta"]) => void;
  onError: (message: string, kind: string) => void;
}

// Streams live per-agent events from /api/generate/stream (SSE over POST via fetch).
export async function generateStream(
  req: GenerateRequest,
  handlers: StreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/generate/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch (e) {
    handlers.onError("Could not reach the server. Is the backend running?", "network");
    return;
  }
  if (!res.ok || !res.body) {
    handlers.onError(`Stream failed (${res.status})`, "server");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = chunk
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let evt: any;
      try {
        evt = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (evt.type === "step") handlers.onStep(evt.node, evt.trace);
      else if (evt.type === "result") handlers.onResult(evt.script, evt.meta);
      else if (evt.type === "error") handlers.onError(evt.error, evt.kind || "agent");
    }
  }
}
