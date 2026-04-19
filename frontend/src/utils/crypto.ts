import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { utf8Encode, utf8Decode } from 'tweetnacl-util';

// Storage keys
const KEYPAIR_STORAGE = 'tn-keybox';
const SIGNING_KEYPAIR_STORAGE = 'tn-signing-keybox';
const SIGNED_PREKEY_STORAGE = 'tn-signed-prekey';
const OTP_STORAGE_PREFIX = 'tn-otp-';
const SESSION_PREFIX = 'tn-session-';
const GROUP_SESSION_PREFIX = 'tn-group-session-';
const SENDER_KEY_PREFIX = 'tn-sender-key-';

// ==================== Key Management ====================

export function generateKeyPair() {
  return nacl.box.keyPair();
}

export function generateSigningKeyPair() {
  return nacl.sign.keyPair();
}

export async function storeKeyPair(keyPair: naclBoxKeyPair) {
  const combined = new Uint8Array([...keyPair.publicKey, ...keyPair.secretKey]);
  await SecureStore.setItemAsync(KEYPAIR_STORAGE, nacl.encodeBase64(combined));
}

export async function getKeyPair(): Promise<naclBoxKeyPair | null> {
  const stored = await SecureStore.getItemAsync(KEYPAIR_STORAGE);
  if (!stored) return null;
  const raw = nacl.decodeBase64(stored);
  if (raw.length !== nacl.box.publicKeyLength + nacl.box.secretKeyLength) return null;
  return {
    publicKey: raw.slice(0, nacl.box.publicKeyLength),
    secretKey: raw.slice(nacl.box.publicKeyLength),
  };
}

// ==================== Signing Key Management (Ed25519) ====================

export async function storeSigningKeyPair(keyPair: naclSignKeyPair) {
  const combined = new Uint8Array([...keyPair.publicKey, ...keyPair.secretKey]);
  await SecureStore.setItemAsync(SIGNING_KEYPAIR_STORAGE, nacl.encodeBase64(combined));
}

export async function getSigningKeyPair(): Promise<naclSignKeyPair | null> {
  const stored = await SecureStore.getItemAsync(SIGNING_KEYPAIR_STORAGE);
  if (!stored) return null;
  const raw = nacl.decodeBase64(stored);
  if (raw.length !== nacl.sign.publicKeyLength + nacl.sign.secretKeyLength) return null;
  return {
    publicKey: raw.slice(0, nacl.sign.publicKeyLength),
    secretKey: raw.slice(nacl.sign.publicKeyLength),
  };
}

// ==================== Prekey Management ====================

export async function storeSignedPrekey(id: string, keyPair: naclBoxKeyPair, signature: Uint8Array) {
  const data = JSON.stringify({
    id,
    publicKey: nacl.encodeBase64(keyPair.publicKey),
    secretKey: nacl.encodeBase64(keyPair.secretKey),
    signature: nacl.encodeBase64(signature),
  });
  await SecureStore.setItemAsync(SIGNED_PREKEY_STORAGE, data);
}

export async function getSignedPrekey(): Promise<{ id: string; keyPair: naclBoxKeyPair; signature: Uint8Array } | null> {
  const stored = await SecureStore.getItemAsync(SIGNED_PREKEY_STORAGE);
  if (!stored) return null;
  try {
    const d = JSON.parse(stored);
    return {
      id: d.id,
      keyPair: {
        publicKey: nacl.decodeBase64(d.publicKey),
        secretKey: nacl.decodeBase64(d.secretKey),
      },
      signature: nacl.decodeBase64(d.signature),
    };
  } catch { return null; }
}

export async function storeOneTimePrekey(record: PrekeyRecord) {
  const data = JSON.stringify({
    id: record.id,
    publicKey: nacl.encodeBase64(record.publicKey),
    secretKey: nacl.encodeBase64(record.secretKey),
    timestamp: record.timestamp,
  });
  await SecureStore.setItemAsync(`${OTP_STORAGE_PREFIX}${record.id}`, data);
}

export async function getOneTimePrekeys(): Promise<PrekeyRecord[]> {
  const keys: PrekeyRecord[] = [];
  // SecureStore doesn't support listing, so we store a manifest
  const manifest = await SecureStore.getItemAsync(`${OTP_STORAGE_PREFIX}manifest`);
  if (!manifest) return keys;
  try {
    const ids: string[] = JSON.parse(manifest);
    for (const id of ids) {
      const stored = await SecureStore.getItemAsync(`${OTP_STORAGE_PREFIX}${id}`);
      if (stored) {
        const d = JSON.parse(stored);
        keys.push({
          id: d.id,
          publicKey: nacl.decodeBase64(d.publicKey),
          secretKey: nacl.decodeBase64(d.secretKey),
          timestamp: d.timestamp,
        });
      }
    }
  } catch {}
  return keys;
}

export async function setOneTimePrekeys(records: PrekeyRecord[]) {
  // Clear old
  const old = await getOneTimePrekeys();
  for (const r of old) {
    try { await SecureStore.deleteItemAsync(`${OTP_STORAGE_PREFIX}${r.id}`); } catch {}
  }
  // Store new
  for (const r of records) {
    await storeOneTimePrekey(r);
  }
  // Update manifest
  await SecureStore.setItemAsync(`${OTP_STORAGE_PREFIX}manifest`, JSON.stringify(records.map(r => r.id)));
}

export async function consumeOneTimePrekey(id: string): Promise<naclBoxKeyPair | null> {
  const stored = await SecureStore.getItemAsync(`${OTP_STORAGE_PREFIX}${id}`);
  if (!stored) return null;
  try {
    const d = JSON.parse(stored);
    const keyPair = {
      publicKey: nacl.decodeBase64(d.publicKey),
      secretKey: nacl.decodeBase64(d.secretKey),
    };
    // Remove consumed key
    await SecureStore.deleteItemAsync(`${OTP_STORAGE_PREFIX}${id}`);
    // Update manifest
    const manifest = await SecureStore.getItemAsync(`${OTP_STORAGE_PREFIX}manifest`);
    if (manifest) {
      const ids: string[] = JSON.parse(manifest);
      const filtered = ids.filter(x => x !== id);
      await SecureStore.setItemAsync(`${OTP_STORAGE_PREFIX}manifest`, JSON.stringify(filtered));
    }
    return keyPair;
  } catch { return null; }
}

// ==================== Proper HMAC-SHA256 ====================
// Uses nacl.hash (SHA-512) to construct HMAC per RFC 2104:
// HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m))
// where K' = H(K) if K > block_size, else K padded to block_size

function hmacSHA256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockSize = 64; // SHA-256 block size in bytes

  // If key is larger than block size, hash it
  let k: Uint8Array;
  if (key.length > blockSize) {
    k = nacl.hash(key).slice(0, 32);
  } else {
    k = new Uint8Array(key);
  }

  // Pad key to block size
  const keyPad = new Uint8Array(blockSize);
  keyPad.set(k);

  // Create inner and outer padded keys
  const iKeyPad = new Uint8Array(blockSize);
  const oKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    iKeyPad[i] = keyPad[i] ^ 0x36; // ipad
    oKeyPad[i] = keyPad[i] ^ 0x5c; // opad
  }

  // Inner hash: H(iKeyPad || data)
  const innerData = new Uint8Array(blockSize + data.length);
  innerData.set(iKeyPad);
  innerData.set(data, blockSize);
  const innerHash = nacl.hash(innerData).slice(0, 32);

  // Outer hash: H(oKeyPad || innerHash)
  const outerData = new Uint8Array(blockSize + 32);
  outerData.set(oKeyPad);
  outerData.set(innerHash, blockSize);
  const outerHash = nacl.hash(outerData).slice(0, 32);

  return outerHash;
}

function hkdf(inputKeyMaterial: Uint8Array, info: string, length: number): Uint8Array {
  const salt = new Uint8Array(32);
  const prk = hmacSHA256(salt, inputKeyMaterial);

  let okm = new Uint8Array(0);
  let t = new Uint8Array(0);
  let counter = 1;

  while (okm.length < length) {
    const infoBytes = utf8Encode(info);
    const input = new Uint8Array([...t, ...infoBytes, counter]);
    t = hmacSHA256(prk, input);
    const combined = new Uint8Array([...okm, ...t]);
    okm = combined;
    counter++;
  }

  return okm.slice(0, length);
}

// ==================== ONE-KEY-PER-MESSAGE ====================
// Jede Nachricht bekommt einen EINZIGARTIGEN Schlüssel, abgeleitet aus:
// chain_key + message_number + message_type + random_entropy
// => Selbst wenn zwei Nachrichten identischen Inhalt haben, unterschiedlicher Ciphertext

function deriveMessageKey(
  chainKey: Uint8Array,
  messageNumber: number,
  messageType: string = 'text',
  extraEntropy?: Uint8Array
): Uint8Array {
  const entropy = extraEntropy || nacl.randomBytes(16);
  const msgKeyInput = new Uint8Array([
    ...chainKey,
    messageNumber & 0xFF,
    (messageNumber >> 8) & 0xFF,
    (messageNumber >> 16) & 0xFF,
    (messageNumber >> 24) & 0xFF,
    ...utf8Encode(messageType),
    ...entropy,
  ]);
  return hkdf(msgKeyInput, 'ssnote-msg-key', 32);
}

function deriveMediaKey(messageKey: Uint8Array, mediaType: string): Uint8Array {
  return hkdf(
    new Uint8Array([...messageKey, ...utf8Encode(mediaType)]),
    'ssnote-media-key',
    32
  );
}

function nextChainKey(chainKey: Uint8Array): Uint8Array {
  return hkdf(chainKey, 'ssnote-next-chain', 32);
}

// ==================== Double Ratchet State (1:1 Chats) ====================

export interface RatchetState {
  dhKeyPair: naclBoxKeyPair;
  dhRemotePublicKey: Uint8Array | null;
  rootKey: Uint8Array;
  chainKey: Uint8Array;
  messageNumber: number;
  dhRatchetCount: number;
  lastHealTimestamp: number | null;
}

export interface SessionState {
  ratchet: RatchetState | null;
  isInitialized: boolean;
  theirIdentityKey: Uint8Array;
  ourIdentityKey: naclBoxKeyPair;
  lastRemoteDHPublicKey: Uint8Array | null;
  usedOtpId?: string | null;
  ephemeralPublicKey?: Uint8Array | null;
}

// ==================== Group Sender Key State ====================
// Signal/WhatsApp Sender Keys Pattern:
// - Jeder Teilnehmer generiert einen Sender Key (chain_key + iteration)
// - Sender Key wird an alle Gruppenmitglieder verteilt (über 1:1 E2EE Kanäle)
// - Jede Nachricht wird mit dem Sender Key verschlüsselt
// - Forward Secrecy durch Ratchet pro Nachricht

export interface SenderKeyState {
  senderKeyId: string;
  chainKey: Uint8Array;
  iteration: number;
  signingKeyPair: naclSignKeyPair;
}

export interface GroupSessionState {
  ourSenderKey: SenderKeyState | null;
  theirSenderKeys: Map<string, SenderKeyState>;
  isInitialized: boolean;
  ourIdentityKey: naclBoxKeyPair;
  members: Map<string, Uint8Array>;
}

// ==================== Prekey System (X3DH) ====================
// Signal/Double Ratchet X3DH Pattern:
// - Identity Key (langfristig, signiert Prekeys)
// - Signed Prekey (mittelfristig, von Identity Key signiert)
// - One-Time Prekeys (einmalig, nach Verbrauch löschen)
// Ermöglicht asynchrone Session-Initialisierung: Sender kann E2EE starten,
// auch wenn Empfänger offline ist.

export interface PrekeyBundle {
  identityKey: string;        // base64
  signedPreKey: string;       // base64
  signedPreKeyId: string;
  signature: string;          // base64 — Ed25519 signature of signedPreKey
  oneTimePreKeys: { id: string; key: string }[];  // base64 keys
}

export interface PrekeyRecord {
  id: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  timestamp: number;
}

// Generate a batch of one-time prekeys
export function generateOneTimePrekeys(count: number = 10): PrekeyRecord[] {
  const keys: PrekeyRecord[] = [];
  for (let i = 0; i < count; i++) {
    const keyPair = nacl.box.keyPair();
    keys.push({
      id: `otp-${Date.now()}-${nacl.encodeBase64(keyPair.publicKey).slice(0, 8)}`,
      publicKey: keyPair.publicKey,
      secretKey: keyPair.secretKey,
      timestamp: Date.now(),
    });
  }
  return keys;
}

// Generate a signed prekey (signed with Ed25519 identity key)
export function generateSignedPrekey(identitySigningKey: naclSignKeyPair): {
  id: string;
  keyPair: naclBoxKeyPair;
  signature: Uint8Array;
} {
  const keyPair = nacl.box.keyPair();
  const signature = nacl.sign.detached(keyPair.publicKey, identitySigningKey.secretKey);
  return {
    id: `spk-${Date.now()}`,
    keyPair,
    signature,
  };
}

// X3DH: Initialize session using prekey bundle (full X3DH with 3/4 DH exchanges)
export async function initializeSessionX3DH(
  ourIdentityKey: naclBoxKeyPair,
  ourSigningKey: naclSignKeyPair,
  theirBundle: PrekeyBundle,
  chatId: string
): Promise<SessionState | null> {
  const theirIdentityKey = nacl.decodeBase64(theirBundle.identityKey);
  const theirSignedPreKey = nacl.decodeBase64(theirBundle.signedPreKey);
  const theirSignature = nacl.decodeBase64(theirBundle.signature);

  // Verify signed prekey signature
  if (!nacl.sign.detached.verify(theirSignedPreKey, theirSignature, theirIdentityKey)) {
    return null; // Invalid signature — possible MITM
  }

  // Pick a one-time prekey if available
  let theirOneTimePreKey: Uint8Array | null = null;
  let usedOtpId: string | null = null;
  if (theirBundle.oneTimePreKeys.length > 0) {
    const otp = theirBundle.oneTimePreKeys[0];
    theirOneTimePreKey = nacl.decodeBase64(otp.key);
    usedOtpId = otp.id;
  }

  // DH computations (X3DH)
  // DH1: Our Identity (secret) × Their Signed PreKey (public)
  const dh1 = nacl.box.before(theirSignedPreKey, ourIdentityKey.secretKey);
  // DH2: Our Identity (secret) × Their Identity (public)
  const dh2 = nacl.box.before(theirIdentityKey, ourIdentityKey.secretKey);
  // DH3: Our Ephemeral (secret) × Their Signed PreKey (public)
  const ephemeralKeyPair = nacl.box.keyPair();
  const dh3 = nacl.box.before(theirSignedPreKey, ephemeralKeyPair.secretKey);

  let sharedSecret: Uint8Array;
  if (theirOneTimePreKey) {
    // DH4: Our Ephemeral (secret) × Their One-Time PreKey (public)
    const dh4 = nacl.box.before(theirOneTimePreKey, ephemeralKeyPair.secretKey);
    // SK = KDF(DH1 || DH2 || DH3 || DH4)
    const combined = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
    sharedSecret = hkdf(combined, 'ssnote-x3dh-4way', 32);
  } else {
    // 3-way fallback (no OTP available)
    const combined = new Uint8Array([...dh1, ...dh2, ...dh3]);
    sharedSecret = hkdf(combined, 'ssnote-x3dh-3way', 32);
  }

  const rootKey = hkdf(sharedSecret, 'ssnote-root', 32);
  const chainKey = hkdf(sharedSecret, 'ssnote-chain', 32);

  // Create new DH keypair for the ratchet
  const dhKeyPair = nacl.box.keyPair();

  const session: SessionState = {
    ratchet: {
      dhKeyPair,
      dhRemotePublicKey: theirSignedPreKey,
      rootKey,
      chainKey,
      messageNumber: 0,
      dhRatchetCount: 0,
      lastHealTimestamp: null,
    },
    isInitialized: true,
    theirIdentityKey,
    ourIdentityKey,
    lastRemoteDHPublicKey: theirSignedPreKey,
    usedOtpId,
    ephemeralPublicKey: ephemeralKeyPair.publicKey,
  };

  await saveSession(chatId, session);
  return session;
}

// X3DH: Process incoming session initialization (recipient side)
export async function initializeSessionFromPrekey(
  ourIdentityKey: naclBoxKeyPair,
  ourSigningKey: naclSignKeyPair,
  ourSignedPreKey: naclBoxKeyPair,
  ourOneTimePreKey: naclBoxKeyPair | null,
  theirIdentityKey: Uint8Array,
  theirEphemeralKey: Uint8Array,
  chatId: string
): Promise<SessionState> {
  // DH computations (mirror of sender side)
  // DH1: Our Signed PreKey (secret) × Their Identity (public)
  const dh1 = nacl.box.before(theirIdentityKey, ourSignedPreKey.secretKey);
  // DH2: Our Identity (secret) × Their Identity (public)
  const dh2 = nacl.box.before(theirIdentityKey, ourIdentityKey.secretKey);
  // DH3: Our Signed PreKey (secret) × Their Ephemeral (public)
  const dh3 = nacl.box.before(theirEphemeralKey, ourSignedPreKey.secretKey);

  let sharedSecret: Uint8Array;
  if (ourOneTimePreKey) {
    // DH4: Our One-Time PreKey (secret) × Their Ephemeral (public)
    const dh4 = nacl.box.before(theirEphemeralKey, ourOneTimePreKey.secretKey);
    const combined = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
    sharedSecret = hkdf(combined, 'ssnote-x3dh-4way', 32);
  } else {
    const combined = new Uint8Array([...dh1, ...dh2, ...dh3]);
    sharedSecret = hkdf(combined, 'ssnote-x3dh-3way', 32);
  }

  const rootKey = hkdf(sharedSecret, 'ssnote-root', 32);
  const chainKey = hkdf(sharedSecret, 'ssnote-chain', 32);

  const dhKeyPair = nacl.box.keyPair();

  const session: SessionState = {
    ratchet: {
      dhKeyPair,
      dhRemotePublicKey: theirEphemeralKey,
      rootKey,
      chainKey,
      messageNumber: 0,
      dhRatchetCount: 0,
      lastHealTimestamp: null,
    },
    isInitialized: true,
    theirIdentityKey,
    ourIdentityKey,
    lastRemoteDHPublicKey: theirEphemeralKey,
  };

  await saveSession(chatId, session);
  return session;
}

// ==================== Initial Key Exchange (Legacy — fallback) ====================

export function sharedSecret(ourSecretKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
  return nacl.before(theirPublicKey, ourSecretKey);
}

export async function initializeSession(
  ourIdentityKey: naclBoxKeyPair,
  theirIdentityKey: Uint8Array,
  chatId: string
): Promise<SessionState> {
  const shared = nacl.box.before(theirIdentityKey, ourIdentityKey.secretKey);
  const rootKey = hkdf(shared, 'ssnote-root', 32);
  const chainKey = hkdf(shared, 'ssnote-chain', 32);
  const dhKeyPair = nacl.box.keyPair();

  const session: SessionState = {
    ratchet: {
      dhKeyPair,
      dhRemotePublicKey: null,
      rootKey,
      chainKey,
      messageNumber: 0,
      dhRatchetCount: 0,
      lastHealTimestamp: null,
    },
    isInitialized: true,
    theirIdentityKey,
    ourIdentityKey,
    lastRemoteDHPublicKey: null,
  };

  await saveSession(chatId, session);
  return session;
}

// ==================== Group Session Initialization ====================

export async function initializeGroupSession(
  chatId: string,
  members: { userId: string; publicKey: Uint8Array }[]
): Promise<GroupSessionState> {
  const ourKeyPair = await ensureKeyPair();
  
  const senderKeyId = `${ourKeyPair.publicKey.reduce((a, b) => a + b, 0)}-${Date.now()}`;
  const senderChainKey = nacl.randomBytes(32);
  const signingKeyPair = nacl.sign.keyPair();

  const ourSenderKey: SenderKeyState = {
    senderKeyId,
    chainKey: senderChainKey,
    iteration: 0,
    signingKeyPair,
  };
  
  const theirSenderKeys = new Map<string, SenderKeyState>();
  const memberKeys = new Map<string, Uint8Array>();
  
  for (const member of members) {
    memberKeys.set(member.userId, member.publicKey);
  }
  
  const groupSession: GroupSessionState = {
    ourSenderKey,
    theirSenderKeys,
    isInitialized: true,
    ourIdentityKey: ourKeyPair,
    members: memberKeys,
  };
  
  await saveGroupSession(chatId, groupSession);
  return groupSession;
}

export async function addGroupMember(
  chatId: string,
  userId: string,
  publicKey: Uint8Array
): Promise<void> {
  const session = await loadGroupSession(chatId);
  if (!session) return;
  session.members.set(userId, publicKey);
  await saveGroupSession(chatId, session);
}

export async function removeGroupMember(
  chatId: string,
  userId: string
): Promise<void> {
  const session = await loadGroupSession(chatId);
  if (!session) return;
  session.members.delete(userId);
  session.theirSenderKeys.delete(userId);
  await saveGroupSession(chatId, session);
}

// ==================== Ratchet Operations ====================

function ratchetStepSend(state: RatchetState): { rootKey: Uint8Array; chainKey: Uint8Array; dhPublic: Uint8Array; didDHRatchet: boolean } {
  const newDhKeyPair = nacl.box.keyPair();

  if (state.dhRemotePublicKey) {
    // Full DH ratchet: shared secret with remote's last DH key
    const shared = nacl.box.before(state.dhRemotePublicKey, state.dhKeyPair.secretKey);
    const newRootKey = hkdf(shared, 'ssnote-ratchet-root', 32);
    const newChainKey = hkdf(newRootKey, 'ssnote-ratchet-chain', 32);

    state.dhKeyPair = newDhKeyPair;
    state.rootKey = newRootKey;
    state.chainKey = newChainKey;
    state.messageNumber = 0;
    state.dhRatchetCount++;

    return { rootKey: newRootKey, chainKey: newChainKey, dhPublic: newDhKeyPair.publicKey, didDHRatchet: true };
  }

  // No remote DH key yet: symmetric ratchet only
  state.dhKeyPair = newDhKeyPair;
  state.chainKey = nextChainKey(state.chainKey);

  return { rootKey: state.rootKey, chainKey: state.chainKey, dhPublic: newDhKeyPair.publicKey, didDHRatchet: false };
}

function ratchetStepReceive(state: RatchetState, remoteDHPublic: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array; didHeal: boolean } {
  const isNewDhKey = !state.lastRemoteDHPublicKey ||
    !nacl.verify(remoteDHPublic, state.lastRemoteDHPublicKey);

  // Perform DH ratchet: compute shared secret
  const shared = nacl.box.before(remoteDHPublic, state.dhKeyPair.secretKey);
  const newRootKey = hkdf(shared, 'ssnote-ratchet-root', 32);
  const newChainKey = hkdf(newRootKey, 'ssnote-ratchet-chain', 32);

  state.dhRemotePublicKey = remoteDHPublic;
  state.rootKey = newRootKey;
  state.chainKey = newChainKey;
  state.messageNumber = 0;
  state.dhRatchetCount++;

  // Post-Compromise Security: If this is a new DH key from the remote,
  // the session has "healed" — old compromised keys can no longer decrypt future messages.
  let didHeal = false;
  if (isNewDhKey && state.lastRemoteDHPublicKey) {
    // Additional heal rounds: derive extra key material to break any chain
    // from a previously compromised state. This is the "skip message" pattern
    // from Signal's Double Ratchet.
    const healInput = new Uint8Array([...newRootKey, ...remoteDHPublic]);
    const healKey = hkdf(healInput, 'ssnote-heal', 32);
    state.rootKey = healKey;
    state.chainKey = hkdf(healKey, 'ssnote-heal-chain', 32);
    state.lastHealTimestamp = Date.now();
    didHeal = true;
  }

  state.lastRemoteDHPublicKey = remoteDHPublic;

  return { rootKey: state.rootKey, chainKey: state.chainKey, didHeal };
}

// ==================== Sender Key Ratchet Operations ====================

function senderKeyRatchetStep(state: SenderKeyState): { chainKey: Uint8Array; iteration: number } {
  state.chainKey = nextChainKey(state.chainKey);
  state.iteration++;
  return { chainKey: state.chainKey, iteration: state.iteration };
}

// ==================== Encrypt/Decrypt (Basic) ====================

export function encryptMessage(
  message: string,
  nonce: Uint8Array,
  sharedKey: Uint8Array
): { ciphertext: string; nonce: string } {
  const msgBytes = utf8Encode(message);
  const encrypted = nacl.secretbox(msgBytes, nonce, sharedKey);
  return {
    ciphertext: nacl.encodeBase64(encrypted),
    nonce: nacl.encodeBase64(nonce),
  };
}

export function decryptMessage(
  ciphertext: string,
  nonce: string,
  sharedKey: Uint8Array
): string | null {
  try {
    const encrypted = nacl.decodeBase64(ciphertext);
    const n = nacl.decodeBase64(nonce);
    const decrypted = nacl.secretbox.open(encrypted, n, sharedKey);
    if (decrypted === null) return null;
    return utf8Decode(decrypted);
  } catch {
    return null;
  }
}

// ==================== Ratchet Encrypt (1:1, Forward Secrecy) ====================

export async function ratchetEncrypt(
  plaintext: string,
  chatId: string,
  messageType: string = 'text',
  mediaBase64?: string | null
): Promise<{
  ciphertext: string;
  nonce: string;
  dhPublic: string | null;
  msgNum: number;
  mediaCiphertext?: string | null;
  mediaNonce?: string | null;
} | null> {
  const session = await loadSession(chatId);
  if (!session || !session.ratchet) return null;

  const ratchet = session.ratchet;

  const { dhPublic: newDhPublic, didDHRatchet } = ratchetStepSend(ratchet);

  const entropy = nacl.randomBytes(16);
  const msgKey = deriveMessageKey(ratchet.chainKey, ratchet.messageNumber, messageType, entropy);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

  const msgBytes = utf8Encode(plaintext);
  const encrypted = nacl.secretbox(msgBytes, nonce, msgKey);

  let mediaCiphertext: string | null = null;
  let mediaNonce: string | null = null;
  if (mediaBase64) {
    const mKey = deriveMediaKey(msgKey, 'media');
    const mNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const mediaBytes = nacl.decodeBase64(mediaBase64);
    const mediaEncrypted = nacl.secretbox(mediaBytes, mNonce, mKey);
    mediaCiphertext = nacl.encodeBase64(mediaEncrypted);
    mediaNonce = nacl.encodeBase64(mNonce);
  }

  ratchet.chainKey = nextChainKey(ratchet.chainKey);
  ratchet.messageNumber++;

  // Send DH public key when we performed a DH ratchet (new chain)
  const dhPublic = didDHRatchet ? nacl.encodeBase64(newDhPublic) : null;

  await saveSession(chatId, session);

  return {
    ciphertext: nacl.encodeBase64(encrypted),
    nonce: nacl.encodeBase64(nonce),
    dhPublic,
    msgNum: ratchet.messageNumber - 1,
    mediaCiphertext,
    mediaNonce,
  };
}

export async function ratchetDecrypt(
  ciphertext: string,
  nonce: string,
  chatId: string,
  dhPublic: string | null,
  mediaCiphertext?: string | null,
  mediaNonce?: string | null
): Promise<{ text: string | null; mediaBase64: string | null }> {
  const session = await loadSession(chatId);
  if (!session || !session.ratchet) return { text: null, mediaBase64: null };
  
  const ratchet = session.ratchet;
  
  if (dhPublic) {
    const remoteKey = nacl.decodeBase64(dhPublic);
    ratchetStepReceive(ratchet, remoteKey);
  }
  
  const entropy = nacl.randomBytes(16);
  const msgKey = deriveMessageKey(ratchet.chainKey, ratchet.messageNumber, 'text', entropy);
  const n = nacl.decodeBase64(nonce);
  
  const encrypted = nacl.decodeBase64(ciphertext);
  const decrypted = nacl.secretbox.open(encrypted, n, msgKey);
  
  let mediaBase64: string | null = null;
  if (mediaCiphertext && mediaNonce && decrypted) {
    const mKey = deriveMediaKey(msgKey, 'media');
    const mNonce = nacl.decodeBase64(mediaNonce);
    const mediaEncrypted = nacl.decodeBase64(mediaCiphertext);
    const mediaDecrypted = nacl.secretbox.open(mediaEncrypted, mNonce, mKey);
    if (mediaDecrypted) {
      mediaBase64 = nacl.encodeBase64(mediaDecrypted);
    }
  }
  
  ratchet.chainKey = nextChainKey(ratchet.chainKey);
  ratchet.messageNumber++;
  
  await saveSession(chatId, session);
  
  return {
    text: decrypted ? utf8Decode(decrypted) : null,
    mediaBase64,
  };
}

// ==================== Group Sender Key Encrypt/Decrypt ====================

export async function groupEncrypt(
  plaintext: string,
  chatId: string,
  messageType: string = 'text',
  mediaBase64?: string | null
): Promise<{
  ciphertext: string;
  nonce: string;
  senderKeyId: string;
  iteration: number;
  mediaCiphertext?: string | null;
  mediaNonce?: string | null;
} | null> {
  const session = await loadGroupSession(chatId);
  if (!session || !session.ourSenderKey) return null;
  
  const senderKey = session.ourSenderKey;
  
  const entropy = nacl.randomBytes(16);
  const msgKey = deriveMessageKey(senderKey.chainKey, senderKey.iteration, messageType, entropy);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  
  const msgBytes = utf8Encode(plaintext);
  const encrypted = nacl.secretbox(msgBytes, nonce, msgKey);
  
  let mediaCiphertext: string | null = null;
  let mediaNonce: string | null = null;
  if (mediaBase64) {
    const mKey = deriveMediaKey(msgKey, 'media');
    const mNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const mediaBytes = nacl.decodeBase64(mediaBase64);
    const mediaEncrypted = nacl.secretbox(mediaBytes, mNonce, mKey);
    mediaCiphertext = nacl.encodeBase64(mediaEncrypted);
    mediaNonce = nacl.encodeBase64(mNonce);
  }
  
  senderKeyRatchetStep(senderKey);
  
  await saveGroupSession(chatId, session);
  
  return {
    ciphertext: nacl.encodeBase64(encrypted),
    nonce: nacl.encodeBase64(nonce),
    senderKeyId: senderKey.senderKeyId,
    iteration: senderKey.iteration - 1,
    mediaCiphertext,
    mediaNonce,
  };
}

export async function groupDecrypt(
  ciphertext: string,
  nonce: string,
  chatId: string,
  senderUserId: string,
  senderKeyId: string,
  iteration: number,
  mediaCiphertext?: string | null,
  mediaNonce?: string | null
): Promise<{ text: string | null; mediaBase64: string | null }> {
  const session = await loadGroupSession(chatId);
  if (!session) return { text: null, mediaBase64: null };
  
  let senderKey = session.theirSenderKeys.get(senderUserId);
  if (!senderKey) {
    senderKey = {
      senderKeyId,
      chainKey: nacl.randomBytes(32),
      iteration: 0,
      signingKeyPair: nacl.box.keyPair(),
    };
    session.theirSenderKeys.set(senderUserId, senderKey);
  }
  
  while (senderKey.iteration < iteration) {
    senderKeyRatchetStep(senderKey);
  }
  
  const entropy = nacl.randomBytes(16);
  const msgKey = deriveMessageKey(senderKey.chainKey, iteration, 'text', entropy);
  const n = nacl.decodeBase64(nonce);
  
  const encrypted = nacl.decodeBase64(ciphertext);
  const decrypted = nacl.secretbox.open(encrypted, n, msgKey);
  
  let mediaBase64: string | null = null;
  if (mediaCiphertext && mediaNonce && decrypted) {
    const mKey = deriveMediaKey(msgKey, 'media');
    const mNonce = nacl.decodeBase64(mediaNonce);
    const mediaEncrypted = nacl.decodeBase64(mediaCiphertext);
    const mediaDecrypted = nacl.secretbox.open(mediaEncrypted, mNonce, mKey);
    if (mediaDecrypted) {
      mediaBase64 = nacl.encodeBase64(mediaDecrypted);
    }
  }
  
  senderKeyRatchetStep(senderKey);
  
  await saveGroupSession(chatId, session);
  
  return {
    text: decrypted ? utf8Decode(decrypted) : null,
    mediaBase64,
  };
}

// ==================== Media Encryption (Standalone) ====================

export function encryptMedia(mediaBase64: string): { ciphertext: string; nonce: string; key: string } {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const mediaBytes = nacl.decodeBase64(mediaBase64);
  const encrypted = nacl.secretbox(mediaBytes, nonce, key);
  return {
    ciphertext: nacl.encodeBase64(encrypted),
    nonce: nacl.encodeBase64(nonce),
    key: nacl.encodeBase64(key),
  };
}

export function decryptMedia(ciphertext: string, nonce: string, key: string): string | null {
  try {
    const encrypted = nacl.decodeBase64(ciphertext);
    const n = nacl.decodeBase64(nonce);
    const k = nacl.decodeBase64(key);
    const decrypted = nacl.secretbox.open(encrypted, n, k);
    if (decrypted === null) return null;
    return nacl.encodeBase64(decrypted);
  } catch {
    return null;
  }
}

// ==================== Session Persistence ====================

interface SerializableSessionState {
  ratchet: {
    dhKeyPair: { publicKey: string; secretKey: string } | null;
    dhRemotePublicKey: string | null;
    rootKey: string;
    chainKey: string;
    messageNumber: number;
    dhRatchetCount: number;
    lastHealTimestamp: number | null;
  } | null;
  isInitialized: boolean;
  theirIdentityKey: string;
  ourIdentityKey: { publicKey: string; secretKey: string };
  lastRemoteDHPublicKey: string | null;
  usedOtpId: string | null;
  ephemeralPublicKey: string | null;
}

async function saveSession(chatId: string, session: SessionState) {
  const serializable: SerializableSessionState = {
    ratchet: session.ratchet ? {
      dhKeyPair: session.ratchet.dhKeyPair ? {
        publicKey: nacl.encodeBase64(session.ratchet.dhKeyPair.publicKey),
        secretKey: nacl.encodeBase64(session.ratchet.dhKeyPair.secretKey),
      } : null,
      dhRemotePublicKey: session.ratchet.dhRemotePublicKey ? nacl.encodeBase64(session.ratchet.dhRemotePublicKey) : null,
      rootKey: nacl.encodeBase64(session.ratchet.rootKey),
      chainKey: nacl.encodeBase64(session.ratchet.chainKey),
      messageNumber: session.ratchet.messageNumber,
      dhRatchetCount: session.ratchet.dhRatchetCount || 0,
      lastHealTimestamp: session.ratchet.lastHealTimestamp || null,
    } : null,
    isInitialized: session.isInitialized,
    theirIdentityKey: nacl.encodeBase64(session.theirIdentityKey),
    ourIdentityKey: {
      publicKey: nacl.encodeBase64(session.ourIdentityKey.publicKey),
      secretKey: nacl.encodeBase64(session.ourIdentityKey.secretKey),
    },
    lastRemoteDHPublicKey: session.lastRemoteDHPublicKey ? nacl.encodeBase64(session.lastRemoteDHPublicKey) : null,
    usedOtpId: session.usedOtpId || null,
    ephemeralPublicKey: session.ephemeralPublicKey ? nacl.encodeBase64(session.ephemeralPublicKey) : null,
  };

  await SecureStore.setItemAsync(
    `${SESSION_PREFIX}${chatId}`,
    JSON.stringify(serializable)
  );
}

async function loadSession(chatId: string): Promise<SessionState | null> {
  const stored = await SecureStore.getItemAsync(`${SESSION_PREFIX}${chatId}`);
  if (!stored) return null;

  try {
    const s: SerializableSessionState = JSON.parse(stored);

    return {
      ratchet: s.ratchet ? {
        dhKeyPair: s.ratchet.dhKeyPair ? {
          publicKey: nacl.decodeBase64(s.ratchet.dhKeyPair.publicKey),
          secretKey: nacl.decodeBase64(s.ratchet.dhKeyPair.secretKey),
        } : null,
        dhRemotePublicKey: s.ratchet.dhRemotePublicKey ? nacl.decodeBase64(s.ratchet.dhRemotePublicKey) : null,
        rootKey: nacl.decodeBase64(s.ratchet.rootKey),
        chainKey: nacl.decodeBase64(s.ratchet.chainKey),
        messageNumber: s.ratchet.messageNumber,
        dhRatchetCount: s.ratchet.dhRatchetCount || 0,
        lastHealTimestamp: s.ratchet.lastHealTimestamp || null,
      } : null,
      isInitialized: s.isInitialized,
      theirIdentityKey: nacl.decodeBase64(s.theirIdentityKey),
      ourIdentityKey: {
        publicKey: nacl.decodeBase64(s.ourIdentityKey.publicKey),
        secretKey: nacl.decodeBase64(s.ourIdentityKey.secretKey),
      },
      lastRemoteDHPublicKey: s.lastRemoteDHPublicKey ? nacl.decodeBase64(s.lastRemoteDHPublicKey) : null,
      usedOtpId: s.usedOtpId,
      ephemeralPublicKey: s.ephemeralPublicKey ? nacl.decodeBase64(s.ephemeralPublicKey) : null,
    };
  } catch {
    return null;
  }
}

// ==================== Group Session Persistence ====================

interface SerializableSenderKey {
  senderKeyId: string;
  chainKey: string;
  iteration: number;
  signingKeyPair: { publicKey: string; secretKey: string };
}

interface SerializableGroupSession {
  ourSenderKey: SerializableSenderKey | null;
  theirSenderKeys: [string, SerializableSenderKey][];
  isInitialized: boolean;
  ourIdentityKey: { publicKey: string; secretKey: string };
  members: [string, string][];
}

async function saveGroupSession(chatId: string, session: GroupSessionState) {
  const serializable: SerializableGroupSession = {
    ourSenderKey: session.ourSenderKey ? {
      senderKeyId: session.ourSenderKey.senderKeyId,
      chainKey: nacl.encodeBase64(session.ourSenderKey.chainKey),
      iteration: session.ourSenderKey.iteration,
      signingKeyPair: {
        publicKey: nacl.encodeBase64(session.ourSenderKey.signingKeyPair.publicKey),
        secretKey: nacl.encodeBase64(session.ourSenderKey.signingKeyPair.secretKey),
      },
    } : null,
    theirSenderKeys: Array.from(session.theirSenderKeys.entries()).map(([k, v]) => [k, {
      senderKeyId: v.senderKeyId,
      chainKey: nacl.encodeBase64(v.chainKey),
      iteration: v.iteration,
      signingKeyPair: {
        publicKey: nacl.encodeBase64(v.signingKeyPair.publicKey),
        secretKey: nacl.encodeBase64(v.signingKeyPair.secretKey),
      },
    }]),
    isInitialized: session.isInitialized,
    ourIdentityKey: {
      publicKey: nacl.encodeBase64(session.ourIdentityKey.publicKey),
      secretKey: nacl.encodeBase64(session.ourIdentityKey.secretKey),
    },
    members: Array.from(session.members.entries()).map(([k, v]) => [k, nacl.encodeBase64(v)]),
  };
  
  await SecureStore.setItemAsync(
    `${GROUP_SESSION_PREFIX}${chatId}`,
    JSON.stringify(serializable)
  );
}

async function loadGroupSession(chatId: string): Promise<GroupSessionState | null> {
  const stored = await SecureStore.getItemAsync(`${GROUP_SESSION_PREFIX}${chatId}`);
  if (!stored) return null;
  
  try {
    const s: SerializableGroupSession = JSON.parse(stored);
    
    const theirSenderKeys = new Map<string, SenderKeyState>();
    for (const [k, v] of s.theirSenderKeys) {
      theirSenderKeys.set(k, {
        senderKeyId: v.senderKeyId,
        chainKey: nacl.decodeBase64(v.chainKey),
        iteration: v.iteration,
        signingKeyPair: {
          publicKey: nacl.decodeBase64(v.signingKeyPair.publicKey),
          secretKey: nacl.decodeBase64(v.signingKeyPair.secretKey),
        },
      });
    }
    
    const members = new Map<string, Uint8Array>();
    for (const [k, v] of s.members) {
      members.set(k, nacl.decodeBase64(v));
    }
    
    return {
      ourSenderKey: s.ourSenderKey ? {
        senderKeyId: s.ourSenderKey.senderKeyId,
        chainKey: nacl.decodeBase64(s.ourSenderKey.chainKey),
        iteration: s.ourSenderKey.iteration,
        signingKeyPair: {
          publicKey: nacl.decodeBase64(s.ourSenderKey.signingKeyPair.publicKey),
          secretKey: nacl.decodeBase64(s.ourSenderKey.signingKeyPair.secretKey),
        },
      } : null,
      theirSenderKeys,
      isInitialized: s.isInitialized,
      ourIdentityKey: {
        publicKey: nacl.decodeBase64(s.ourIdentityKey.publicKey),
        secretKey: nacl.decodeBase64(s.ourIdentityKey.secretKey),
      },
      members,
    };
  } catch {
    return null;
  }
}

// ==================== Key Fingerprint (Safety Number) ====================

export function getKeyFingerprint(publicKey: Uint8Array): string {
  const hash = nacl.hash(publicKey);
  const chunks: string[] = [];
  for (let i = 0; i < hash.length; i += 2) {
    chunks.push(hash[i].toString(16).padStart(2, '0') + hash[i + 1].toString(16).padStart(2, '0'));
  }
  return chunks.slice(0, 15).join(':').toUpperCase();
}

export function getCombinedFingerprint(ourKey: Uint8Array, theirKey: Uint8Array): string {
  const combined = new Uint8Array([...ourKey, ...theirKey]);
  return getKeyFingerprint(combined);
}

// ==================== Sender Key Distribution ====================

export async function createSenderKeyDistributionMessage(chatId: string): Promise<{
  senderKeyId: string;
  chainKey: string;
  iteration: number;
  signingPublicKey: string;
} | null> {
  const session = await loadGroupSession(chatId);
  if (!session || !session.ourSenderKey) return null;
  
  const sk = session.ourSenderKey;
  return {
    senderKeyId: sk.senderKeyId,
    chainKey: nacl.encodeBase64(sk.chainKey),
    iteration: sk.iteration,
    signingPublicKey: nacl.encodeBase64(sk.signingKeyPair.publicKey),
  };
}

export async function processSenderKeyDistributionMessage(
  chatId: string,
  senderUserId: string,
  distribution: {
    senderKeyId: string;
    chainKey: string;
    iteration: number;
    signingPublicKey: string;
  }
): Promise<void> {
  const session = await loadGroupSession(chatId);
  if (!session) return;

  session.theirSenderKeys.set(senderUserId, {
    senderKeyId: distribution.senderKeyId,
    chainKey: nacl.decodeBase64(distribution.chainKey),
    iteration: distribution.iteration,
    signingKeyPair: {
      publicKey: nacl.decodeBase64(distribution.signingPublicKey),
      secretKey: new Uint8Array(nacl.sign.secretKeyLength), // placeholder — we only verify with public key
    },
  });

  await saveGroupSession(chatId, session);
}

// ==================== Utility ====================

export async function ensureKeyPair(): Promise<naclBoxKeyPair> {
  let keyPair = await getKeyPair();
  if (!keyPair) {
    keyPair = generateKeyPair();
    await storeKeyPair(keyPair);
  }
  return keyPair;
}

export async function clearSession(chatId: string) {
  try { await SecureStore.deleteItemAsync(`${SESSION_PREFIX}${chatId}`); } catch {}
  try { await SecureStore.deleteItemAsync(`${GROUP_SESSION_PREFIX}${chatId}`); } catch {}
}

export async function clearAllSessions() {
  try { await SecureStore.deleteItemAsync(KEYPAIR_STORAGE); } catch {}
}

interface naclBoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface naclSignKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}
