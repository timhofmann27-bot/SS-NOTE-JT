# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.1.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

We take the security of SS-Note seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **security@ss-note.example.com** (replace with actual email)

You should receive a response within **48 hours**. If for some reason you do not, please follow up via email to ensure we received your original message.

### Bug Bounty Program

| Severity | Reward |
|----------|--------|
| **Critical** (RCE, E2EE bypass, key extraction) | €5,000 |
| **High** (Auth bypass, data leak, MITM) | €2,000 |
| **Medium** (XSS, CSRF, IDOR) | €500 |
| **Low** (Info disclosure, minor bugs) | €100 |

### What We Consider a Vulnerability

- **E2EE Bypass**: Any way to read message content without the recipient's keys
- **Key Extraction**: Any way to extract private keys from storage
- **Authentication Bypass**: Login without valid credentials
- **Data Leak**: Server-side access to plaintext message content
- **MITM**: Man-in-the-middle attack on session initialization

### What We Do NOT Consider a Vulnerability

- Theoretical attacks that require physical access to an unlocked device
- Attacks that require compromising the user's device OS
- Social engineering attacks
- Denial of service via resource exhaustion (rate limits are in place)

### Preferred Languages

- German
- English

## Security Architecture

### Encryption

- **Transport**: TLS 1.3 (HTTPS/WSS)
- **End-to-End**: X25519 + Kyber-768 (Post-Quantum Hybrid KEM)
- **Key Exchange**: X3DH with One-Time Prekeys
- **Message Encryption**: XSalsa20-Poly1305 (Double Ratchet)
- **Group Encryption**: Pairwise E2EE (Threema-style) + Sender Keys fallback
- **Key Derivation**: HKDF-SHA256 (RFC 5869)
- **Signatures**: Ed25519 for prekey authentication

### Data Protection

- **Server sees**: Only ciphertext, message metadata (type, size, timestamp)
- **Server does NOT see**: Message content, media content, contact relationships (minimized)
- **No IP logging**: IP addresses are never stored- **Audit logs**: Auto-delete after 30 days (TTL index)
- **Status updates**: Auto-delete after 24 hours (TTL index)

### Infrastructure Security

- Non-root Docker containers
- Read-only filesystem
- Capability dropping (ALL caps dropped)
- no-new-privileges enforced
- Security headers on all responses
- Rate limiting on auth endpoints
- JWT token rotation with blacklist

For more details, see [SECURITY_ARCHITECTURE.md](./docs/SECURITY_ARCHITECTURE.md).
