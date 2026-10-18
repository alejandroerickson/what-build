import { noteServerCommit } from "./new-release.ts";

/** The one HTTP client. The web app uses only operations the agents also have. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 409;
  }
  get isNotFound() {
    return this.status === 404 || this.status === 410;
  }
}

const DEFAULT_MESSAGES: Record<number, string> = {
  0: "WhatBuild couldn’t be reached. Check your connection and try again.",
  401: "Your sign-in has expired. Sign in again.",
  403: "You don’t have access to do that.",
  404: "That doesn’t exist, or you don’t have access to it.",
  409: "That changed since you loaded it.",
  422: "WhatBuild couldn’t accept that. Check what you entered.",
  500: "WhatBuild ran into a problem. Try again in a moment.",
};

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

let onChange: ((path: string, operation: string | null) => void) | null = null;
/** Told of every change the server accepted (any method but GET), with the operation it ran, for counting what people do. */
export function setChangeListener(fn: (path: string, operation: string | null) => void) {
  onChange = fn;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("/") ? path : `/api/v1/${path}`, {
      method,
      credentials: "same-origin",
      ...init,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Accept: "application/json", ...(init.headers ?? {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network", DEFAULT_MESSAGES[0]!);
  }
  noteServerCommit(res.headers.get("X-WhatBuild-Commit"));
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    if (res.status === 401) onUnauthenticated?.();
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? DEFAULT_MESSAGES[res.status] ?? `WhatBuild answered with status ${res.status}.`, err?.details);
  }
  if (method !== "GET") onChange?.(path, res.headers.get("X-WhatBuild-Operation"));
  return data as T;
}

/** Whether a string can be an object's id at all: 26 characters of Crockford base32, as the server requires. */
export function isObjectId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    u.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Upload a file's bytes to a grant with progress, the same relay agents use. */
export function putWithProgress(url: string, headers: Record<string, string>, file: Blob, onProgress: (loaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total || file.size);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = `The upload failed (${xhr.status}).`;
        try {
          message = JSON.parse(xhr.responseText).error.message ?? message;
        } catch {
          // keep the default
        }
        reject(new ApiError(xhr.status, "upload_failed", message));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network", DEFAULT_MESSAGES[0]!));
    xhr.send(file);
  });
}
