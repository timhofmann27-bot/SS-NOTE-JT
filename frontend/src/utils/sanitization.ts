/**
 * Client-side input sanitization for JT-Note.
 * Provides real-time sanitization for all user inputs before they are sent to the API.
 * Defense in depth: client sanitizes for UX feedback, server re-validates.
 */

// Maximum lengths matching server-side constants
const MAX_DISPLAY_NAME = 100;
const MAX_GROUP_NAME = 100;
const MAX_STATUS_TEXT = 200;
const MAX_MESSAGE_CONTENT = 10000;
const MAX_USERNAME = 30;

/**
 * Strip control characters from text.
 * Prevents terminal injection and BCP47 spoofing attacks.
 */
function stripControlChars(text: string): string {
  // Remove characters \x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * HTML-encode special characters to prevent XSS when text is rendered.
 * Converts: < > & " ' to their HTML entity equivalents.
 */
function htmlEncode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize display text (names, group names, status).
 * Applied before sending to API and before rendering.
 */
export function sanitizeDisplayText(text: string, maxLength: number = MAX_DISPLAY_NAME): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = stripControlChars(cleaned);
  cleaned = cleaned.slice(0, maxLength);
  return cleaned;
}

/**
 * Sanitize for safe HTML rendering — returns HTML-encoded string.
 * Use this when displaying user-generated content in any HTML/text context.
 */
export function sanitizeForRender(text: string): string {
  if (!text) return '';
  let cleaned = stripControlChars(text);
  return htmlEncode(cleaned);
}

/**
 * Validate and sanitize username input.
 * Strict allowlist: alphanumeric, underscore, hyphen, dot.
 */
export function sanitizeUsername(text: string): string {
  let cleaned = text.trim().toLowerCase();
  cleaned = cleaned.replace(/[^a-z0-9_\-.]/g, '');
  return cleaned.slice(0, MAX_USERNAME);
}

/**
 * Sanitize group name.
 */
export function sanitizeGroupName(text: string): string {
  return sanitizeDisplayText(text, MAX_GROUP_NAME);
}

/**
 * Sanitize status text.
 */
export function sanitizeStatusText(text: string): string {
  return sanitizeDisplayText(text, MAX_STATUS_TEXT);
}

/**
 * Sanitize message content before sending.
 * Note: E2EE messages are encrypted, but this applies to plaintext metadata.
 */
export function sanitizeMessageContent(text: string): string {
  return sanitizeDisplayText(text, MAX_MESSAGE_CONTENT);
}

/**
 * Sanitize search query — strip regex special chars.
 */
export function sanitizeSearchQuery(text: string): string {
  let cleaned = text.trim();
  cleaned = stripControlChars(cleaned);
  // Escape regex special characters
  cleaned = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleaned.slice(0, 200);
}

/**
 * Validate callsign: alphanumeric + hyphen only.
 */
export function sanitizeCallsign(text: string): string {
  let cleaned = text.trim().toUpperCase();
  cleaned = cleaned.replace(/[^A-Z0-9\-]/g, '');
  return cleaned.slice(0, 20);
}

/**
 * Validate that a string is not empty after sanitization.
 */
export function isEmptyAfterSanitization(text: string): boolean {
  return !sanitizeDisplayText(text).trim();
}

/**
 * React Native safe text renderer.
 * For React Native, Text components don't execute HTML, but this
 * ensures consistency and protects against any future web-view rendering.
 */
export function safeText(text: string | null | undefined): string {
  if (!text) return '';
  return stripControlChars(text);
}
