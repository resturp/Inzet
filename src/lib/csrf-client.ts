"use client";

import { CSRF_COOKIE_NAME } from "@/lib/csrf";

type CsrfPayload = {
  token?: string;
};

export function readCsrfTokenFromCookie() {
  if (typeof document === "undefined") {
    return "";
  }

  const parts = document.cookie.split(";");
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("=") ?? "");
    }
  }
  return "";
}

export async function ensureCsrfToken(fetchImpl: typeof fetch = fetch, forceRefresh = false) {
  const existingToken = readCsrfTokenFromCookie();
  if (existingToken && !forceRefresh) {
    return existingToken;
  }

  try {
    const response = await fetchImpl("/api/csrf", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as CsrfPayload;
      if (payload.token && payload.token.length > 0) {
        return payload.token;
      }
    }
  } catch {
    return "";
  }

  return readCsrfTokenFromCookie();
}
