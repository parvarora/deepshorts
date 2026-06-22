// Typed client for the FastAPI backend. One module, every endpoint, clean error surface.
import type {
  GenerateRequest,
  GenerateResponse,
  Options,
  RegenerateRequest,
  Script,
  TraceStep,
} from "./types";

// In production VITE_API_BASE is the Cloud Run service URL (the browser calls it
// directly — see docs/DEPLOY.md). Nullish coalescing (not ||) so a deliberately-empty
// value would still be honored rather than falling back to localhost.
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

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

// Streams live per-agent events over a WebSocket (/api/generate/ws).
//
// Why a WebSocket, not SSE/fetch-streaming: Cloud Run's ingress buffers long-lived
// chunked HTTP responses, so SSE logged 200 OK server-side but never streamed to the
// browser (it 502'd after a minute). A WebSocket is an upgraded full-duplex connection
// the proxy treats as a raw pipe, so each step reaches the UI the instant it's produced.
export function generateStream(
  req: GenerateRequest,
  handlers: StreamHandlers,
): Promise<void> {
  // http(s):// -> ws(s):// — same host, same scheme family.
  const wsUrl = `${API_BASE.replace(/^http/i, "ws")}/api/generate/ws`;

  return new Promise<void>((resolve) => {
    let settled = false; // a result or error was already delivered to the caller
    const fail = (message: string, kind: string) => {
      if (settled) return;
      settled = true;
      handlers.onError(message, kind);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      fail("Could not reach the server. Is the backend running?", "network");
      resolve();
      return;
    }

    ws.onopen = () => ws.send(JSON.stringify(req));

    ws.onmessage = (e) => {
      let evt: any;
      try {
        evt = JSON.parse(e.data);
      } catch {
        return;
      }
      if (evt.type === "step") {
        handlers.onStep(evt.node, evt.trace);
      } else if (evt.type === "result") {
        settled = true;
        handlers.onResult(evt.script, evt.meta);
      } else if (evt.type === "error") {
        settled = true;
        handlers.onError(evt.error, evt.kind || "agent");
      }
    };

    // Fires on connection failure / abnormal close. If we already delivered a
    // result/error this is just the normal teardown and is ignored.
    ws.onerror = () => fail("Connection lost while generating.", "network");

    ws.onclose = () => {
      // Socket closed before any result/error arrived → treat as a failure.
      fail("Connection closed before the script was ready.", "network");
      resolve();
    };
  });
}
