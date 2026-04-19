# SS-Note Security Architecture

## Overview

SS-Note is an end-to-end encrypted, anonymous messaging application designed for security-critical communication. This document describes the security architecture, threat model, and cryptographic protocols used.

## Threat Model

### Assets to Protect

1. **Message Content**: Plaintext of all messages (text, media, voice, location)
2. **Encryption Keys**: X25519 identity keys, Kyber-768 keys, Ed25519 signing keys
3. **User Identity**: Anonymous usernames, callsigns, roles
4. **Communication Metadata**: Who communicates with whom, when, how often

### Threat Actors

| Actor | Capability | Mitigation |
|-------|-----------|------------|
| **Network Attacker** | Eavesdropping, MITM | TLS 1.3 + E2EE (Double Ratchet) |
| **Server Operator** | Full server access | E2EE, no plaintext on server |
| **Quantum Attacker** | Shor's algorithm | Kyber-768 hybrid KEM |
| **Compromised Client** | Key extraction | Forward Secrecy, Heal Ratchet |
| **Metadata Analyst** | Traffic analysis | Metadata minimization, no IP logs |

## Cryptographic Protocol

### 1. Key Generation

Each user generates three key pairs on first launch:

```
X25519 Identity Key:    nacl.box.keyPair()     → 32-byte pub + 32-byte secret
Ed25519 Signing Key:    nacl.sign.keyPair()    → 32-byte pub + 64-byte secret
Kyber-768 PQ Key:       kyber.keypair()        → 1184-byte pub + 2400-byte secret
```

Keys are stored in `expo-secure-store` (native) or `localStorage` (web, obfuscated).

### 2. Session Initialization (X3DH + Post-Quantum)

```
Sender                              Receiver
  |                                    |
  | 1. Fetch prekey bundle             |
  |----------------------------------->|
  | 2. DH1 = DH(I_s, SPK_r)            |
  |    DH2 = DH(I_s, I_r)              |
  |    DH3 = DH(E_s, SPK_r)            |
  |    DH4 = DH(E_s, OPK_r) [if avail] |
  |    PQ = KyberEncaps(PK_r)          |
  |    SK = HKDF(DH1||DH2||DH3||DH4||PQ) |
  |                                    |
  | 3. Send message + E_s + PQ_ct     |
  |----------------------------------->|
  |                                    |
  | 4. DH1 = DH(SPK_r, I_s)            |
  |    DH2 = DH(I_r, I_s)              |
  |    DH3 = DH(SPK_r, E_s)            |
  |    DH4 = DH(OPK_r, E_s) [if used]  |
  |    PQ = KyberDecaps(PQ_ct, SK_r)   |
  |    SK = HKDF(DH1||DH2||DH3||DH4||PQ) |
```

**Security Properties:**
- **Asynchronous**: Sender can start session even if receiver is offline
- **Post-Quantum**: Kyber-768 protects against future quantum computers
- **Authentication**: Signed prekeys prevent MITM (Ed25519 signature)
- **Forward Secrecy**: One-time prekeys ensure each session has unique key material

### 3. Message Encryption (Double Ratchet)

```
For each message:
  1. Symmetric ratchet: chain_key = HMAC-SHA256(chain_key, 0x01)
  2. Message key: msg_key = HKDF(chain_key || entropy, msg_type)
  3. Encrypt: ciphertext = XSalsa20-Poly1305(plaintext, nonce, msg_key)
  4. DH ratchet (every N messages or on new DH key):
     shared = DH(local_dh_secret, remote_dhpublic)
     root_key = HKDF(shared, 'ssnote-ratchet-root')
     chain_key = HKDF(root_key, 'ssnote-ratchet-chain')
```

**Security Properties:**
- **Forward Secrecy**: Past messages cannot be decrypted if current key is compromised
- **Post-Compromise Security (Heal)**: New DH ratchet breaks any compromised chain
- **Message Key Separation**: Each message uses a unique key derived from chain

### 4. Group Encryption (Pairwise + Sender Keys)

**Pairwise Mode (Threema-style):**
- Each message is encrypted individually for every group member
- Uses separate 1:1 session keys per recipient
- If one member's key is compromised, only their messages are readable

**Sender Keys Mode (Signal/WhatsApp-style):**
- Each member has a sender key (chain key + iteration)
- Message encrypted once with sender key, distributed to all
- Faster but: compromised sender key exposes all group messages

### 5. HKDF Implementation

SS-Note implements HKDF-SHA256 per RFC 5869 using `nacl.hash` (SHA-512):

```
HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m))
where K' = H(K) if K > block_size, else K padded to block_size

HKDF(IKM, info, length):
  PRK = HMAC-SHA256(salt=0, IKM)
  OKM = Expand(PRK, info, length)
```

## Data Flow

### Message Sending (1:1)

```
User A                          Server                          User B
  |                               |                               |
  | 1. Load session               |                               |
  | 2. Ratchet encrypt            |                               |
  | 3. Send ciphertext + DH_pub   |                               |
  |------------------------------>|                               |
  |                               | Store ciphertext only          |
  |                               | (never sees plaintext)         |
  |                               |------------------------------>|
  |                               |                               | 4. Ratchet decrypt
  |                               |                               | 5. Update session
```

### Message Sending (Group, Pairwise)

```
User A                          Server                          User B, C, D
  |                               |                               |
  | 1. For each member:           |                               |
  |    - Load 1:1 session         |                               |
  |    - Encrypt individually     |                               |
  | 2. Send pairwise ciphertexts  |                               |
  |------------------------------>|                               |
  |                               | Store per-recipient ciphertexts|
  |                               |------------------------------>|
  |                               |                               | Each decrypts their copy
```

## Server Security

### What the Server Sees

| Data | Stored | Encrypted | Notes |
|------|--------|-----------|-------|
| Message content | ✅ | ✅ | Ciphertext only |
| Media content | ✅ | ✅ | Ciphertext only |
| Message type | ✅ | ❌ | text/image/voice/location |
| Timestamps | ✅ | ❌ | Needed for ordering |
| Sender ID | ✅ | ❌ | Needed for routing |
| Chat participants | ✅ | ❌ | Minimized in list API |
| IP addresses | ❌ | N/A | Never stored |
| Contact relationships | ✅ | ❌ | Minimized (count only in list) |

### What the Server Does NOT See

- **Plaintext message content** — always encrypted client-side
- **Media content** — encrypted client-side
- **Encryption keys** — never leave the device
- **IP addresses** — not logged or stored
- **Audit log data** — auto-deleted after 30 days

### Infrastructure Hardening

- **Non-root containers**: `heimatfunk` user, no shell
- **Read-only filesystem**: Only `/tmp` and `/app/memory` writable
- **Capability dropping**: ALL Linux capabilities removed
- **Security headers**: HSTS, CSP, X-Frame-Options, etc.
- **Rate limiting**: 3 reg/min, 5 login attempts, 15-min lockout
- **JWT rotation**: Refresh tokens blacklisted on use

## Known Limitations

1. **No independent audit** — Code is open source but not yet audited
2. **localStorage on web** — Less secure than native secure store
3. **Custom crypto** — Not a standard library; review required
4. **Centralized server** — Single point of failure/trust
5. **No deniability** — Messages are signed, unlike Off-the-Record

## Comparison with Established Protocols

| Feature | Signal | Threema | SS-Note |
|---------|--------|---------|---------|
| Double Ratchet | ✅ | ✅ | ✅ |
| X3DH | ✅ | ✅ | ✅ |
| Post-Quantum | ❌ | ✅ | ✅ |
| Sender Keys | ✅ | ❌ | ✅ (fallback) |
| Pairwise Group | ❌ | ✅ | ✅ |
| Sealed Sender | ✅ | ❌ | ❌ |
| Deniability | ✅ | ❌ | ❌ |
| Anonymous IDs | ❌ | ✅ | ✅ |

## Audit Checklist

- [x] HKDF-SHA256 implementation (RFC 5869)
- [x] X3DH key exchange
- [x] Double Ratchet with DH ratchet
- [x] Post-Compromise Security (Heal Ratchet)
- [x] Ed25519 prekey signatures
- [x] Kyber-768 hybrid KEM
- [x] No IP logging
- [x] Metadata minimization
- [x] Audit log TTL
- [x] Security headers
- [x] Rate limiting
- [ ] Independent third-party audit
- [ ] Formal verification of crypto
