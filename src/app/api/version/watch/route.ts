import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/api-session";
import { getCurrentDataVersion } from "@/lib/data-version";

function parseSince(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const url = new URL(request.url);
  const since = parseSince(url.searchParams.get("since"));
  const timeoutMs = 25_000;
  const pollIntervalMs = 1_000;
  const deadline = Date.now() + timeoutMs;

  let version = await getCurrentDataVersion();
  if (version > since) {
    return NextResponse.json(
      { data: { version, changed: true } },
      { status: 200 }
    );
  }

  while (Date.now() < deadline && !request.signal.aborted) {
    await sleep(pollIntervalMs, request.signal);
    if (request.signal.aborted) {
      break;
    }
    version = await getCurrentDataVersion();
    if (version > since) {
      return NextResponse.json(
        { data: { version, changed: true } },
        { status: 200 }
      );
    }
  }

  return NextResponse.json(
    { data: { version, changed: false } },
    { status: 200 }
  );
}
