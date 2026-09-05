import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type SmtpTarget = {
  host: string;
  port: number;
};

type SmtpResponse = {
  code: number;
  lines: string[];
};

function shouldSendMail(): boolean {
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  return process.env.SENDMAIL_IN_DEV?.trim().toLowerCase() === "true";
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function extractAddress(value: string): string | null {
  const match = value.match(/<([^<>]+)>/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return value.includes("@") ? value.trim() : null;
}

function describeSendmailSpawnError(error: NodeJS.ErrnoException, sendmailPath: string): Error {
  if (error.code === "ENOENT") {
    return new Error(
      `sendmail ontbreekt op ${sendmailPath}. Installeer een lokale outbound MTA of zet SENDMAIL_PATH naar de sendmail-compatible binary.`
    );
  }

  return error;
}

function parseSmtpTarget(value: string | undefined): SmtpTarget | null {
  const rawValue = value?.trim();
  if (!rawValue) {
    return null;
  }

  const ipv6Match = rawValue.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6Match) {
    const port = ipv6Match[2] ? Number.parseInt(ipv6Match[2], 10) : 25;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`SMTPHOST heeft een ongeldige poort: ${rawValue}`);
    }
    return {
      host: ipv6Match[1],
      port
    };
  }

  const portSeparatorIndex = rawValue.lastIndexOf(":");
  if (portSeparatorIndex > -1 && rawValue.indexOf(":") === portSeparatorIndex) {
    const host = rawValue.slice(0, portSeparatorIndex);
    const port = Number.parseInt(rawValue.slice(portSeparatorIndex + 1), 10);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`SMTPHOST heeft een ongeldige waarde: ${rawValue}`);
    }
    return {
      host,
      port
    };
  }

  return {
    host: rawValue,
    port: 25
  };
}

function formatSmtpAddress(address: string): string {
  const extractedAddress = extractAddress(address);
  if (!extractedAddress) {
    throw new Error("SMTP address is empty");
  }
  return `<${extractedAddress}>`;
}

function formatSmtpData(payload: string): string {
  const normalizedPayload = payload.replace(/\r?\n/g, "\r\n");
  const dotStuffedPayload = normalizedPayload
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");

  return dotStuffedPayload.endsWith("\r\n")
    ? `${dotStuffedPayload}.\r\n`
    : `${dotStuffedPayload}\r\n.\r\n`;
}

function assertSmtpResponse(response: SmtpResponse, expectedCodes: number[], action: string) {
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP ${action} failed: ${response.lines.join(" | ")}`);
  }
}

async function sendViaSmtp(target: SmtpTarget, envelopeFrom: string, recipient: string, payload: string) {
  const timeoutMs = Number.parseInt(process.env.SMTP_TIMEOUT_MS ?? "10000", 10);
  const heloName = sanitizeHeaderValue(process.env.MAIL_HELO_NAME?.trim() || os.hostname() || "localhost");

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let buffer = "";
    let responseLines: string[] = [];
    const queuedResponses: SmtpResponse[] = [];
    let pendingRead: ((response: SmtpResponse) => void) | null = null;
    let settled = false;

    function settle(error?: Error) {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }

    function completeResponse(response: SmtpResponse) {
      if (pendingRead) {
        const resolveRead = pendingRead;
        pendingRead = null;
        resolveRead(response);
        return;
      }
      queuedResponses.push(response);
    }

    function readResponse(): Promise<SmtpResponse> {
      if (queuedResponses.length > 0) {
        return Promise.resolve(queuedResponses.shift()!);
      }

      return new Promise((resolveRead) => {
        pendingRead = resolveRead;
      });
    }

    function writeLine(line: string) {
      socket.write(`${line}\r\n`);
    }

    socket.setTimeout(Number.isFinite(timeoutMs) ? timeoutMs : 10000);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        const match = line.match(/^(\d{3})([ -])/);

        responseLines.push(line);
        if (match?.[2] === " ") {
          completeResponse({
            code: Number.parseInt(match[1], 10),
            lines: responseLines
          });
          responseLines = [];
        }
      }
    });

    socket.on("timeout", () => {
      settle(new Error(`SMTP timeout connecting to ${target.host}:${target.port}`));
    });

    socket.on("error", (error) => {
      settle(error);
    });

    socket.on("close", () => {
      if (!settled) {
        settle(new Error(`SMTP connection closed by ${target.host}:${target.port}`));
      }
    });

    (async () => {
      try {
        assertSmtpResponse(await readResponse(), [220], "greeting");
        writeLine(`EHLO ${heloName}`);
        const ehloResponse = await readResponse();
        if (ehloResponse.code !== 250) {
          writeLine(`HELO ${heloName}`);
          assertSmtpResponse(await readResponse(), [250], "HELO");
        }

        writeLine(`MAIL FROM:${formatSmtpAddress(envelopeFrom)}`);
        assertSmtpResponse(await readResponse(), [250], "MAIL FROM");
        writeLine(`RCPT TO:${formatSmtpAddress(recipient)}`);
        assertSmtpResponse(await readResponse(), [250, 251], "RCPT TO");
        writeLine("DATA");
        assertSmtpResponse(await readResponse(), [354], "DATA");
        socket.write(formatSmtpData(payload));
        assertSmtpResponse(await readResponse(), [250], "message delivery");
        writeLine("QUIT");
        settle();
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

export async function sendMail({ to, subject, text, html }: SendMailInput): Promise<void> {
  if (!shouldSendMail()) {
    return;
  }

  const from = sanitizeHeaderValue(process.env.MAIL_FROM?.trim() || "Inzet <info@frii.nl>");
  const recipient = sanitizeHeaderValue(to);
  const safeSubject = sanitizeHeaderValue(subject);
  const sendmailPath = process.env.SENDMAIL_PATH?.trim() || "/usr/sbin/sendmail";
  const configuredEnvelopeFrom = process.env.MAIL_ENVELOPE_FROM?.trim();
  const envelopeFrom = configuredEnvelopeFrom || extractAddress(from) || "info@frii.nl";
  const messageIdDomain =
    process.env.MAIL_MESSAGE_ID_DOMAIN?.trim() ||
    extractAddress(envelopeFrom)?.split("@")[1] ||
    "frii.nl";
  const messageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  const multipartBoundary = `inzet-${crypto.randomUUID()}`;
  const dateHeader = new Date().toUTCString();

  if (!recipient) {
    throw new Error("recipient is empty");
  }

  const payload = html
    ? [
        `From: ${from}`,
        `To: ${recipient}`,
        `Subject: ${safeSubject}`,
        `Date: ${dateHeader}`,
        `Message-ID: ${messageId}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${multipartBoundary}"`,
        "",
        `--${multipartBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text,
        `--${multipartBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
        `--${multipartBoundary}--`
      ].join("\r\n")
    : [
        `From: ${from}`,
        `To: ${recipient}`,
        `Subject: ${safeSubject}`,
        `Date: ${dateHeader}`,
        `Message-ID: ${messageId}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        text
      ].join("\r\n");

  const smtpTarget = parseSmtpTarget(process.env.SMTPHOST);
  if (smtpTarget) {
    await sendViaSmtp(smtpTarget, envelopeFrom, recipient, payload);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(sendmailPath, ["-i", "-f", envelopeFrom, "--", recipient], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let stdinError: NodeJS.ErrnoException | null = null;
    let settled = false;

    function settle(error?: Error) {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle(describeSendmailSpawnError(error, sendmailPath));
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      stdinError = error;
    });

    child.on("close", (code) => {
      if (code === 0) {
        settle();
        return;
      }
      const detail = stderr.trim() || stdinError?.message || "unknown error";
      settle(new Error(`sendmail exit code ${code}: ${detail}`));
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
