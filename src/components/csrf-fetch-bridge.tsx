"use client";

import { useEffect } from "react";
import { CSRF_HEADER_NAME } from "@/lib/csrf";
import { ensureCsrfToken } from "@/lib/csrf-client";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

declare global {
  interface Window {
    __inzetCsrfFetchPatched?: boolean;
  }
}

function resolveUrl(input: RequestInfo | URL) {
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.origin);
    }
    if (input instanceof URL) {
      return input;
    }
    return new URL(input.url, window.location.origin);
  } catch {
    return null;
  }
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

export function CsrfFetchBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || window.__inzetCsrfFetchPatched) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    window.__inzetCsrfFetchPatched = true;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = resolveUrl(input);
      const method = getRequestMethod(input, init);
      const isUnsafeMethod = UNSAFE_METHODS.has(method);
      const isSameOrigin = requestUrl?.origin === window.location.origin;
      const isApiCall = requestUrl?.pathname.startsWith("/api/");

      if (!isUnsafeMethod || !isSameOrigin || !isApiCall) {
        return originalFetch(input, init);
      }

      const headers = new Headers(
        init?.headers ??
          (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
      );
      if (!headers.has(CSRF_HEADER_NAME)) {
        const csrfToken = await ensureCsrfToken(originalFetch);
        if (csrfToken) {
          headers.set(CSRF_HEADER_NAME, csrfToken);
        }
      }

      const nextInit: RequestInit = {
        ...init,
        headers,
        credentials: init?.credentials ?? "same-origin"
      };
      const response = await originalFetch(input, nextInit);
      if (response.status !== 403) {
        return response;
      }

      const refreshedToken = await ensureCsrfToken(originalFetch, true);
      if (!refreshedToken || refreshedToken === headers.get(CSRF_HEADER_NAME)) {
        return response;
      }

      const retryHeaders = new Headers(headers);
      retryHeaders.set(CSRF_HEADER_NAME, refreshedToken);
      return originalFetch(input, {
        ...nextInit,
        headers: retryHeaders
      });
    };
  }, []);

  return null;
}
