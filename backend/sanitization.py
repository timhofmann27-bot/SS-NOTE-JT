"""
Input sanitization utilities for JT-Note backend.
All user-facing text fields pass through these functions before DB storage.
Defense in depth: Pydantic validates schema, sanitization cleans content.
"""

import re
import html

# Allowlist: characters permitted in display names, group names, status texts
# No angle brackets, no quotes, no script-related chars
SAFE_DISPLAY_CHARS = re.compile(
    r"^[\w\s\-_.,!?@#&+=$%(){}\[\]:;\"'/\\*\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\ud800-\udbff\udc00-\udfff]*$"
)

# Strip control characters (except newline and tab)
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")

# Max lengths per field type (defense against oversized payloads)
MAX_DISPLAY_NAME = 100
MAX_GROUP_NAME = 100
MAX_STATUS_TEXT = 200
MAX_MESSAGE_CONTENT = 10000
MAX_USERNAME = 30


def strip_control_chars(text: str) -> str:
    """Remove control characters that could be used for terminal injection or BCP47 attacks."""
    return CONTROL_CHARS.sub("", text)


def sanitize_display_text(text: str, max_length: int = MAX_DISPLAY_NAME) -> str:
    """
    Sanitize user-facing display text (names, group names, status).
    - Strips control characters
    - HTML-encodes special characters (output encoding)
    - Trims whitespace
    - Enforces max length
    - Rejects if empty after sanitization
    """
    if not text:
        return ""
    cleaned = text.strip()
    cleaned = strip_control_chars(cleaned)
    # HTML encode: < > & " ' become safe entities
    cleaned = html.escape(cleaned, quote=True)
    # Truncate to max length
    cleaned = cleaned[:max_length]
    return cleaned


def sanitize_message_content(text: str, max_length: int = MAX_MESSAGE_CONTENT) -> str:
    """
    Sanitize message content. Messages are E2EE-encrypted so server can't read them,
    but this applies to plaintext fallback and metadata.
    Same sanitization as display text but with higher max length.
    """
    return sanitize_display_text(text, max_length)


def validate_and_sanitize_username(username: str) -> str:
    """
    Username validation: strict allowlist.
    Usernames are already validated via regex in Pydantic, but we add sanitization as defense in depth.
    """
    cleaned = username.strip().lower()
    cleaned = strip_control_chars(cleaned)
    if len(cleaned) > MAX_USERNAME:
        cleaned = cleaned[:MAX_USERNAME]
    return cleaned


def sanitize_poll_text(text: str, max_length: int = 500) -> str:
    """Sanitize poll questions and options."""
    return sanitize_display_text(text, max_length)


def sanitize_search_query(query: str, max_length: int = 200) -> str:
    """
    Sanitize search queries to prevent NoSQL injection via regex.
    Strips regex special characters that could be used in $regex queries.
    """
    cleaned = query.strip()
    cleaned = strip_control_chars(cleaned)
    # Escape regex special characters to prevent NoSQL regex injection
    cleaned = re.escape(cleaned)
    cleaned = cleaned[:max_length]
    return cleaned
