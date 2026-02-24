const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_TAG_REGEX = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const HTML_TAG_REGEX = /<\/?[a-z][^>]*>/gi;
const JAVASCRIPT_PROTOCOL_REGEX = /\bjavascript\s*:/gi;

export function sanitizeText(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  const withoutControlChars = normalized.replace(CONTROL_CHAR_REGEX, "");
  const withoutScriptTags = withoutControlChars.replace(SCRIPT_TAG_REGEX, "");
  const withoutHtmlTags = withoutScriptTags.replace(HTML_TAG_REGEX, "");
  return withoutHtmlTags.replace(JAVASCRIPT_PROTOCOL_REGEX, "");
}

export function sanitizeTrimmedText(value: string): string {
  return sanitizeText(value).trim();
}

export function sanitizeOptionalTrimmedText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return sanitizeTrimmedText(value);
}

export function sanitizeNullableText(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const sanitized = sanitizeText(value);
  return sanitized.trim().length > 0 ? sanitized : null;
}

export function sanitizeNullableTrimmedText(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const sanitized = sanitizeTrimmedText(value);
  return sanitized.length > 0 ? sanitized : null;
}
