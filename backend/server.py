from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from bson.errors import InvalidId
import os
import logging
import bcrypt
import jwt
import secrets
import json
import re
import hashlib
import random
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime, timezone, timedelta

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'ssnote_db')]

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET or len(JWT_SECRET) < 64:
    JWT_SECRET = secrets.token_hex(64)
    logger.warning("JWT_SECRET zu kurz — generiere zufälligen 128-char Secret.")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60       # 1h statt 24h (Security Upgrade)
REFRESH_TOKEN_DAYS = 7          # 7 Tage statt 30

FRONTEND_URL = os.environ.get('FRONTEND_URL', os.environ.get('EXPO_PUBLIC_BACKEND_URL', '*'))
BCRYPT_ROUNDS = 12              # Erhöht von Default 10
SECURE_COOKIES = os.environ.get('SECURE_COOKIES', 'false').lower() == 'true'

def cookie_kwargs() -> dict:
    """Return secure cookie settings — secure flag enabled in production"""
    return {"httponly": True, "secure": SECURE_COOKIES, "samesite": "lax", "path": "/"}

app = FastAPI(title="SS-Note API", docs_url=None, redoc_url=None)
api_router = APIRouter(prefix="/api")

# ==================== WEBSOCKET: Real-time messaging ====================
import socketio

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=FRONTEND_URL.split(',') if FRONTEND_URL != '*' else [], logger=False)

# Mount Socket.IO onto FastAPI — works with server:app
sio_asgi = socketio.ASGIApp(sio, socketio_path='/api/socket.io')
app.mount('/api/socket.io', sio_asgi)

# Map: user_id → set of socket sids
connected_users: dict[str, set] = {}

@sio.event
async def connect(sid, environ, auth):
    """Authenticate WebSocket connection via JWT token"""
    token = auth.get('token') if auth else None
    if not token:
        raise socketio.exceptions.ConnectionRefusedError('No token')
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get('type') != 'access':
            raise socketio.exceptions.ConnectionRefusedError('Invalid token type')
        user_id = payload['sub']
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if not user:
            raise socketio.exceptions.ConnectionRefusedError('User not found')
        # Store user_id in session
        await sio.save_session(sid, {'user_id': user_id, 'username': user.get('username', '')})
        # Track connected user
        if user_id not in connected_users:
            connected_users[user_id] = set()
        connected_users[user_id].add(sid)
        # Join user to their chat rooms
        chats = await db.chats.find({"participant_ids": ObjectId(user_id)}).to_list(100)
        for chat in chats:
            await sio.enter_room(sid, f"chat:{str(chat['_id'])}")
        # Update online status
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "online", "last_seen": datetime.now(timezone.utc)}})
        logger.info(f"WS connected: {user.get('username')} (sid={sid[:8]})")
    except jwt.InvalidTokenError:
        raise socketio.exceptions.ConnectionRefusedError('Invalid token')

@sio.event
async def disconnect(sid):
    session = await sio.get_session(sid)
    user_id = session.get('user_id') if session else None
    if user_id:
        connected_users.get(user_id, set()).discard(sid)
        if not connected_users.get(user_id):
            connected_users.pop(user_id, None)
            await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "offline", "last_seen": datetime.now(timezone.utc)}})

@sio.event
async def typing(sid, data):
    """Handle typing indicator via WebSocket"""
    session = await sio.get_session(sid)
    if not session:
        return
    chat_id = data.get('chat_id')
    if chat_id:
        await sio.emit('typing', {'user_id': session['user_id'], 'username': session.get('username', ''), 'chat_id': chat_id}, room=f"chat:{chat_id}", skip_sid=sid)

async def ws_emit_to_chat(chat_id: str, event: str, data: dict, skip_user: str = None):
    """Emit event to all connected users in a chat"""
    skip_sids = connected_users.get(skip_user, set()) if skip_user else set()
    for s in skip_sids:
        pass  # We'll use room broadcast which is more efficient
    await sio.emit(event, data, room=f"chat:{chat_id}")

async def ws_emit_to_user(user_id: str, event: str, data: dict):
    """Emit event to specific user's all connected devices"""
    sids = connected_users.get(user_id, set())
    for sid in sids:
        await sio.emit(event, data, to=sid)

# ==================== SECURITY MIDDLEWARE ====================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response"""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

app.add_middleware(SecurityHeadersMiddleware)

from fastapi.responses import JSONResponse

@app.exception_handler(InvalidId)
async def invalid_id_handler(request: Request, exc: InvalidId):
    return JSONResponse(status_code=400, content={"detail": "Ungültige ID"})

# ==================== CONSTANTS ====================
VALID_SECURITY_LEVELS = ["UNCLASSIFIED", "RESTRICTED", "CONFIDENTIAL", "SECRET"]
VALID_TRUST_LEVELS = ["UNVERIFIED", "VERIFIED", "TRUSTED", "BLOCKED"]
VALID_MESSAGE_TYPES = ["text", "image", "voice", "file", "system", "poll", "location"]
USERNAME_REGEX = re.compile(r'^[a-zA-Z0-9_\-\.]{3,30}$')
BASE64_REGEX = re.compile(r'^[A-Za-z0-9+/]*={0,2}$')

def validate_object_id(oid: str) -> ObjectId:
    try:
        return ObjectId(oid)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Ungültige ID")

AUDIT_LOG_TTL_DAYS = 30  # Audit logs auto-delete after 30 days

async def audit_log(action: str, user_id: str = None, details: dict = None):
    """Security audit — no IP storage, with TTL auto-expiry"""
    doc = {
        "action": action,
        "user_id": user_id,
        "details": details or {},
        "timestamp": datetime.now(timezone.utc),
    }
    # Set TTL for auto-deletion
    doc["expires_at"] = datetime.now(timezone.utc) + timedelta(days=AUDIT_LOG_TTL_DAYS)
    await db.audit_log.insert_one(doc)

# ==================== USERNAME GENERATOR ====================

ANIMALS_DE = ["wolf", "adler", "falke", "luchs", "baer", "fuchs", "habicht", "marder", "uhu", "otter",
              "dachs", "rabe", "sperber", "wisent", "elch", "biber", "drossel", "greif", "panther", "viper"]

def generate_username() -> str:
    """Generate anonymous username: tier-hexcode (e.g. wolf-a3f2e1)"""
    animal = random.choice(ANIMALS_DE)
    hex_code = secrets.token_hex(3)  # 6 hex chars
    return f"{animal}-{hex_code}"

# ==================== MODELS (ANONYMOUS AUTH) ====================

class RegisterInput(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    passkey: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    callsign: Optional[str] = Field(default=None, max_length=20)

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_REGEX.match(v):
            raise ValueError('Username: 3-30 Zeichen, nur a-z, 0-9, _, -, .')
        return v

    @field_validator('passkey')
    @classmethod
    def validate_passkey(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('Passkey muss mindestens 8 Zeichen haben')
        return v

class LoginInput(BaseModel):
    username: str
    passkey: str

class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    callsign: Optional[str] = Field(default=None, max_length=20)
    status_text: Optional[str] = Field(default=None, max_length=200)
    avatar_base64: Optional[str] = Field(default=None, max_length=500000)

class ContactAdd(BaseModel):
    user_id: str
    trust_level: str = "UNVERIFIED"
    @field_validator('trust_level')
    @classmethod
    def validate_trust(cls, v: str) -> str:
        if v not in VALID_TRUST_LEVELS:
            raise ValueError(f'Ungültiger Trust-Level. Erlaubt: {VALID_TRUST_LEVELS}')
        return v

class ChatCreate(BaseModel):
    participant_ids: List[str]
    name: Optional[str] = Field(default=None, max_length=100)
    is_group: bool = False
    group_role_map: Optional[dict] = None
    security_level: str = "UNCLASSIFIED"
    @field_validator('security_level')
    @classmethod
    def validate_sec(cls, v: str) -> str:
        if v not in VALID_SECURITY_LEVELS:
            raise ValueError(f'Ungültige Sicherheitsstufe.')
        return v

class MessageSend(BaseModel):
    chat_id: str
    content: str = Field(min_length=1, max_length=10000)
    message_type: str = "text"
    security_level: str = "UNCLASSIFIED"
    self_destruct_seconds: Optional[int] = Field(default=None, ge=5, le=604800)
    is_emergency: bool = False
    media_base64: Optional[str] = Field(default=None, max_length=5000000)
    reply_to: Optional[str] = Field(default=None, max_length=50)
    @field_validator('security_level')
    @classmethod
    def validate_sec(cls, v: str) -> str:
        if v not in VALID_SECURITY_LEVELS:
            raise ValueError(f'Ungültige Sicherheitsstufe.')
        return v
    @field_validator('message_type')
    @classmethod
    def validate_msg_type(cls, v: str) -> str:
        if v not in VALID_MESSAGE_TYPES:
            raise ValueError(f'Ungültiger Nachrichtentyp.')
        return v
    @field_validator('content')
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Nachricht darf nicht leer sein')
        return v
    @field_validator('media_base64')
    @classmethod
    def validate_media(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 0:
            clean = v.split(',')[-1] if ',' in v else v
            if not BASE64_REGEX.match(clean[:100]):
                raise ValueError('media_base64 muss gültiges Base64 sein')
        return v

class MessageAck(BaseModel):
    message_ids: List[str] = Field(max_length=50)

class PasskeyChange(BaseModel):
    old_passkey: str
    new_passkey: str = Field(min_length=8, max_length=128)

class PublicKeyUpload(BaseModel):
    public_key: str = Field(min_length=10, max_length=100)
    fingerprint: Optional[str] = Field(default=None, max_length=100)

class PushTokenUpload(BaseModel):
    push_token: str = Field(min_length=10, max_length=500)
    platform: str = "expo"

class EncryptedMessageSend(BaseModel):
    chat_id: str
    ciphertext: str = Field(min_length=1, max_length=500000)
    nonce: str = Field(min_length=1, max_length=100)
    dh_public: Optional[str] = Field(default=None, max_length=100)
    msg_num: int = 0
    message_type: str = "text"
    security_level: str = "UNCLASSIFIED"
    self_destruct_seconds: Optional[int] = Field(default=None, ge=5, le=604800)
    is_emergency: bool = False
    media_ciphertext: Optional[str] = Field(default=None, max_length=10000000)
    media_nonce: Optional[str] = Field(default=None, max_length=100)
    sender_key_id: Optional[str] = Field(default=None, max_length=200)
    sender_key_iteration: Optional[int] = Field(default=None)
    reply_to: Optional[str] = Field(default=None, max_length=50)
    @field_validator('security_level')
    @classmethod
    def validate_sec(cls, v: str) -> str:
        if v not in VALID_SECURITY_LEVELS:
            raise ValueError(f'Ungültige Sicherheitsstufe.')
        return v
    @field_validator('message_type')
    @classmethod
    def validate_msg_type(cls, v: str) -> str:
        if v not in VALID_MESSAGE_TYPES:
            raise ValueError(f'Ungültiger Nachrichtentyp.')
        return v

class PollCreate(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    options: List[str] = Field(min_length=2, max_length=10)
    @field_validator('options')
    @classmethod
    def validate_options(cls, v: List[str]) -> List[str]:
        cleaned = [opt.strip() for opt in v if opt.strip()]
        if len(cleaned) < 2:
            raise ValueError('Mindestens 2 Optionen erforderlich')
        if len(cleaned) > 10:
            raise ValueError('Maximal 10 Optionen erlaubt')
        return cleaned

class PollVote(BaseModel):
    option_index: int = Field(ge=0, le=9)

# ==================== HELPERS ====================

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: str) -> str:
    return jwt.encode({"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES), "type": "access", "jti": secrets.token_hex(8)}, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    return jwt.encode({"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS), "type": "refresh", "jti": secrets.token_hex(8)}, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert")
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        blacklisted = await db.token_blacklist.find_one({"token_hash": token_hash})
        if blacklisted:
            raise HTTPException(status_code=401, detail="Token wurde widerrufen")
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Ungültiger Token-Typ")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="Benutzer nicht gefunden")
        user["id"] = str(user["_id"])
        del user["_id"]
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token abgelaufen")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ungültiger Token")

def serialize_user(user: dict) -> dict:
    u = {**user}
    if "_id" in u:
        u["id"] = str(u["_id"])
        del u["_id"]
    u.pop("password_hash", None)
    for k, v in u.items():
        if isinstance(v, datetime): u[k] = v.isoformat()
        if isinstance(v, ObjectId): u[k] = str(v)
    return u

def serialize_user_public(user: dict) -> dict:
    u = serialize_user(user)
    for field in ["contacts", "blocked_users"]:
        u.pop(field, None)
    return u

def serialize_message(msg: dict) -> dict:
    m = {**msg}
    if "_id" in m:
        m["id"] = str(m["_id"])
        del m["_id"]
    for k, v in m.items():
        if isinstance(v, datetime): m[k] = v.isoformat()
        if isinstance(v, ObjectId): m[k] = str(v)
    return m

def serialize_chat(chat: dict) -> dict:
    c = {**chat}
    if "_id" in c:
        c["id"] = str(c["_id"])
        del c["_id"]
    for k, v in c.items():
        if isinstance(v, datetime): c[k] = v.isoformat()
        if isinstance(v, ObjectId): c[k] = str(v)
    if "participant_ids" in c:
        c["participant_ids"] = [str(p) for p in c["participant_ids"]]
    return c

TESTING = os.environ.get('TESTING', 'false').lower() == 'true'

# ==================== AUTH (ANONYMOUS — Username + Passkey) ====================

@api_router.post("/auth/register")
async def register(input: RegisterInput, request: Request, response: Response):
    username = input.username.strip().lower()
    client_ip = request.client.host if request.client else "unknown"
    
    # Rate limit (disabled in testing mode)
    if not TESTING:
        reg_key = f"reg:{client_ip}"
        reg_attempt = await db.login_attempts.find_one_and_update(
            {"identifier": reg_key},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc)}, "$setOnInsert": {"locked_until": None}},
            upsert=True, return_document=True
        )
        if reg_attempt and reg_attempt.get("count", 0) > 3:
            last = reg_attempt.get("last_attempt")
            if last:
                if last.tzinfo is None: last = last.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - last).total_seconds() < 60:
                    raise HTTPException(status_code=429, detail="Zu viele Registrierungen. Bitte warte 1 Minute.")
                else:
                    await db.login_attempts.delete_one({"identifier": reg_key})
    
    existing = await db.users.find_one({"username": username})
    if existing:
        raise HTTPException(status_code=400, detail="Username bereits vergeben")
    
    user_doc = {
        "username": username,
        "password_hash": hash_password(input.passkey),
        "name": input.name,
        "callsign": input.callsign or username.upper()[:6],
        "role": "soldier",
        "status": "online",
        "status_text": "Bereit",
        "avatar_base64": None,
        "trust_level": "VERIFIED",
        "add_me_code": generate_add_code(),
        "add_me_code_updated_at": datetime.now(timezone.utc),
        "contacts": [],
        "blocked_users": [],
        "created_at": datetime.now(timezone.utc),
        "last_seen": datetime.now(timezone.utc),
    }
    
    try:
        result = await db.users.insert_one(user_doc)
    except Exception as e:
        if "duplicate key" in str(e).lower():
            raise HTTPException(status_code=400, detail="Username bereits vergeben")
        raise
    
    user_id = str(result.inserted_id)
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, **cookie_kwargs(), max_age=ACCESS_TOKEN_MINUTES*60)
    response.set_cookie(key="refresh_token", value=refresh_token, **cookie_kwargs(), max_age=REFRESH_TOKEN_DAYS*86400)

    await audit_log("register", user_id, {"username": username})
    
    user_doc["id"] = user_id
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    for k, v in user_doc.items():
        if isinstance(v, datetime): user_doc[k] = v.isoformat()
    
    return {"user": user_doc, "token": access_token}

@api_router.post("/auth/login")
async def login(input: LoginInput, request: Request, response: Response):
    username = input.username.strip().lower()
    client_ip = request.client.host if request.client else "unknown"
    identifier = f"{client_ip}:{username}"
    
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt:
        locked_until = attempt.get("locked_until")
        now = datetime.now(timezone.utc)
        if locked_until:
            if locked_until.tzinfo is None: locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > now:
                remaining = int((locked_until - now).total_seconds())
                raise HTTPException(status_code=429, detail=f"Zu viele Fehlversuche. Gesperrt für {remaining} Sekunden.")
            else:
                await db.login_attempts.delete_one({"identifier": identifier})
                attempt = None
        elif attempt.get("count", 0) >= 5:
            await db.login_attempts.update_one({"identifier": identifier}, {"$set": {"locked_until": now + timedelta(minutes=15)}})
            raise HTTPException(status_code=429, detail="Zu viele Fehlversuche. Gesperrt für 900 Sekunden.")
    
    user = await db.users.find_one({"username": username})
    if not user:
        await _track_failed_login(identifier)
        await audit_log("login_failed", None, {"username": username})
        raise HTTPException(status_code=401, detail="Ungültige Anmeldedaten")
    
    if not verify_password(input.passkey, user["password_hash"]):
        await _track_failed_login(identifier)
        await audit_log("login_failed", str(user["_id"]), {"username": username})
        raise HTTPException(status_code=401, detail="Ungültige Anmeldedaten")
    
    await db.login_attempts.delete_one({"identifier": identifier})
    user_id = str(user["_id"])
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"status": "online", "last_seen": datetime.now(timezone.utc)}})
    
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, **cookie_kwargs(), max_age=ACCESS_TOKEN_MINUTES*60)
    response.set_cookie(key="refresh_token", value=refresh_token, **cookie_kwargs(), max_age=REFRESH_TOKEN_DAYS*86400)

    await audit_log("login_success", user_id, {"username": username})
    return {"user": serialize_user(user), "token": access_token}

async def _track_failed_login(identifier: str):
    now = datetime.now(timezone.utc)
    result = await db.login_attempts.find_one_and_update(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"last_attempt": now}, "$setOnInsert": {"locked_until": None}},
        upsert=True, return_document=True
    )
    if result and result.get("count", 0) >= 5 and not result.get("locked_until"):
        await db.login_attempts.update_one({"identifier": identifier}, {"$set": {"locked_until": now + timedelta(minutes=15)}})

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"user": user}

@api_router.post("/auth/logout")
async def logout(request: Request, response: Response, user: dict = Depends(get_current_user)):
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "): token = auth_header[7:]
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        await db.token_blacklist.insert_one({"token_hash": token_hash, "user_id": user["id"], "blacklisted_at": datetime.now(timezone.utc), "expires_at": datetime.now(timezone.utc) + timedelta(hours=24)})
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"status": "offline", "last_seen": datetime.now(timezone.utc)}})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    await audit_log("logout", user["id"])
    return {"message": "Abgemeldet"}

@api_router.post("/auth/change-passkey")
async def change_passkey(input: PasskeyChange, request: Request, user: dict = Depends(get_current_user)):
    full_user = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not full_user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    if not verify_password(input.old_passkey, full_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Alter Passkey ist falsch")
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"password_hash": hash_password(input.new_passkey)}})
    await audit_log("passkey_change", user["id"])
    return {"message": "Passkey geändert"}

# ==================== ADD-ME CODE GENERATOR ====================

def generate_add_code() -> str:
    """Generate FUNK-XXXXXX code (6 alphanumeric, uppercase)"""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # No I/O/0/1 for readability
    code = ''.join(random.choice(chars) for _ in range(6))
    return f"FUNK-{code}"

# ==================== USER / PROFILE ====================

@api_router.put("/profile")
async def update_profile(input: ProfileUpdate, user: dict = Depends(get_current_user)):
    updates = {}
    if input.name is not None: updates["name"] = input.name
    if input.callsign is not None: updates["callsign"] = input.callsign
    if input.status_text is not None: updates["status_text"] = input.status_text
    if input.avatar_base64 is not None: updates["avatar_base64"] = input.avatar_base64
    if updates:
        await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": updates})
    updated = await db.users.find_one({"_id": ObjectId(user["id"])}, {"password_hash": 0})
    return {"user": serialize_user(updated)}

@api_router.get("/users/my-add-code")
async def get_my_add_code(user: dict = Depends(get_current_user)):
    """Get current user's Add-Me code"""
    u = await db.users.find_one({"_id": ObjectId(user["id"])})
    code = u.get("add_me_code")
    if not code:
        code = generate_add_code()
        await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"add_me_code": code, "add_me_code_updated_at": datetime.now(timezone.utc)}})
    return {"code": code}

@api_router.post("/users/reset-add-code")
async def reset_add_code(request: Request, user: dict = Depends(get_current_user)):
    """Reset Add-Me code — old code becomes instantly invalid"""
    client_ip = request.client.host if request.client else "unknown"
    # Rate limit: 3 resets/day
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    reset_count = await db.audit_log.count_documents({"action": "add_code_reset", "user_id": user["id"], "timestamp": {"$gte": today_start}})
    if reset_count >= 3:
        raise HTTPException(status_code=429, detail="Maximal 3 Code-Resets pro Tag")
    new_code = generate_add_code()
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"add_me_code": new_code, "add_me_code_updated_at": datetime.now(timezone.utc)}})
    await audit_log("add_code_reset", user["id"])
    return {"code": new_code}

# PRIVACY: Remove global user listing — only confirmed contacts visible
@api_router.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    """Returns ONLY confirmed contacts (no global user list)"""
    confirmed = await db.contacts.find({"owner_id": user["id"], "status": "confirmed"}).to_list(500)
    result = []
    for c in confirmed:
        u = await db.users.find_one({"_id": ObjectId(c["contact_id"])}, {"password_hash": 0, "contacts": 0, "blocked_users": 0, "add_me_code": 0})
        if u:
            result.append(serialize_user_public(u))
    return {"users": result}

@api_router.get("/users/{user_id}")
async def get_user(user_id: str, user: dict = Depends(get_current_user)):
    # Only allow viewing confirmed contacts
    is_contact = await db.contacts.find_one({"owner_id": user["id"], "contact_id": user_id, "status": "confirmed"})
    if not is_contact:
        raise HTTPException(status_code=403, detail="Nur bestätigte Kontakte können angesehen werden")
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"password_hash": 0, "contacts": 0, "blocked_users": 0, "add_me_code": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    return {"user": serialize_user_public(u)}

# ==================== CONTACTS (Add-Me-Code System) ====================

class AddByCodeInput(BaseModel):
    code: str = Field(min_length=6, max_length=12)

@api_router.post("/contacts/add-by-code")
async def add_by_code(input: AddByCodeInput, request: Request, user: dict = Depends(get_current_user)):
    """Send contact request via Add-Me code"""
    code = input.code.strip().upper()
    client_ip = request.client.host if request.client else "unknown"
    
    # Rate limit: 5 code attempts/min (disabled in testing mode)
    if not TESTING:
        rl_key = f"addcode:{user['id']}"
        rl = await db.login_attempts.find_one_and_update(
            {"identifier": rl_key},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc)}, "$setOnInsert": {"locked_until": None}},
            upsert=True, return_document=True
        )
        if rl and rl.get("count", 0) > 5:
            last = rl.get("last_attempt")
            if last:
                if last.tzinfo is None: last = last.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - last).total_seconds() < 60:
                    raise HTTPException(status_code=429, detail="Zu viele Versuche. Bitte warte 1 Minute.")
                else:
                    await db.login_attempts.delete_one({"identifier": rl_key})
    
    target = await db.users.find_one({"add_me_code": code})
    if not target:
        raise HTTPException(status_code=404, detail="Ungültiger Code")
    
    target_id = str(target["_id"])
    if target_id == user["id"]:
        raise HTTPException(status_code=400, detail="Das ist dein eigener Code")
    
    # Check if already contacts
    existing_contact = await db.contacts.find_one({"owner_id": user["id"], "contact_id": target_id, "status": "confirmed"})
    if existing_contact:
        raise HTTPException(status_code=400, detail="Bereits in deinen Kontakten")
    
    # Check if request already exists
    existing_req = await db.contact_requests.find_one({
        "$or": [
            {"requester_id": user["id"], "target_id": target_id, "status": "pending"},
            {"requester_id": target_id, "target_id": user["id"], "status": "pending"},
        ]
    })
    if existing_req:
        raise HTTPException(status_code=400, detail="Anfrage bereits gesendet")
    
    req_doc = {
        "requester_id": user["id"],
        "requester_username": user.get("username", ""),
        "requester_name": user.get("name", ""),
        "requester_callsign": user.get("callsign", ""),
        "target_id": target_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.contact_requests.insert_one(req_doc)
    
    # WebSocket: Notify target user
    await ws_emit_to_user(target_id, "contact:request:new", {
        "request_id": str(result.inserted_id),
        "from_username": user.get("username", ""),
        "from_name": user.get("name", ""),
    })
    
    await audit_log("contact_request_sent", user["id"], {"target_id": target_id})
    return {"message": "Anfrage gesendet!", "request_id": str(result.inserted_id)}

@api_router.get("/contacts/requests")
async def get_contact_requests(user: dict = Depends(get_current_user)):
    """Get incoming and outgoing contact requests"""
    incoming = await db.contact_requests.find({"target_id": user["id"], "status": "pending"}).to_list(100)
    outgoing = await db.contact_requests.find({"requester_id": user["id"], "status": "pending"}).to_list(100)
    
    def serialize_req(r):
        return {
            "id": str(r["_id"]),
            "requester_id": r["requester_id"],
            "requester_username": r.get("requester_username", ""),
            "requester_name": r.get("requester_name", ""),
            "requester_callsign": r.get("requester_callsign", ""),
            "target_id": r["target_id"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat() if isinstance(r["created_at"], datetime) else r["created_at"],
        }
    
    return {"incoming": [serialize_req(r) for r in incoming], "outgoing": [serialize_req(r) for r in outgoing]}

@api_router.post("/contacts/request/{request_id}/accept")
async def accept_contact_request(request_id: str, request: Request, user: dict = Depends(get_current_user)):
    oid = validate_object_id(request_id)
    req = await db.contact_requests.find_one({"_id": oid, "target_id": user["id"], "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Anfrage nicht gefunden")
    
    # Create bidirectional confirmed contacts
    now = datetime.now(timezone.utc)
    requester_id = req["requester_id"]
    
    # Upsert both directions
    for a, b in [(user["id"], requester_id), (requester_id, user["id"])]:
        await db.contacts.update_one(
            {"owner_id": a, "contact_id": b},
            {"$set": {"owner_id": a, "contact_id": b, "status": "confirmed", "confirmed_at": now}},
            upsert=True
        )
    
    await db.contact_requests.update_one({"_id": oid}, {"$set": {"status": "accepted"}})
    
    # WebSocket: Notify requester
    await ws_emit_to_user(requester_id, "contact:request:accepted", {
        "request_id": request_id,
        "by_username": user.get("username", ""),
    })
    
    client_ip = request.client.host if request.client else "unknown"
    await audit_log("contact_accepted", user["id"], {"requester_id": requester_id})
    return {"message": "Kontakt bestätigt!"}

@api_router.post("/contacts/request/{request_id}/reject")
async def reject_contact_request(request_id: str, request: Request, user: dict = Depends(get_current_user)):
    oid = validate_object_id(request_id)
    req = await db.contact_requests.find_one({"_id": oid, "target_id": user["id"], "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Anfrage nicht gefunden")
    await db.contact_requests.update_one({"_id": oid}, {"$set": {"status": "rejected"}})
    return {"message": "Anfrage abgelehnt"}

@api_router.get("/contacts")
async def get_contacts(user: dict = Depends(get_current_user)):
    """Only return CONFIRMED contacts"""
    contacts = await db.contacts.find({"owner_id": user["id"], "status": "confirmed"}).to_list(500)
    result = []
    for c in contacts:
        u = await db.users.find_one({"_id": ObjectId(c["contact_id"])}, {"password_hash": 0, "add_me_code": 0})
        if u:
            user_data = serialize_user_public(u)
            user_data["trust_level"] = "VERIFIED"
            result.append(user_data)
    return {"contacts": result}

@api_router.delete("/contacts/{contact_id}")
async def remove_contact(contact_id: str, request: Request, user: dict = Depends(get_current_user)):
    await db.contacts.delete_one({"owner_id": user["id"], "contact_id": contact_id})
    await db.contacts.delete_one({"owner_id": contact_id, "contact_id": user["id"]})
    # WebSocket: Notify other user
    await ws_emit_to_user(contact_id, "contact:removed", {"by_user_id": user["id"]})
    client_ip = request.client.host if request.client else "unknown"
    await audit_log("contact_removed", user["id"], {"contact_id": contact_id})
    return {"message": "Kontakt entfernt"}

# ==================== CHATS ====================

@api_router.post("/chats")
async def create_chat(input: ChatCreate, user: dict = Depends(get_current_user)):
    all_participants = list(set([user["id"]] + input.participant_ids))
    if input.is_group:
        user_contacts = await db.contacts.find({"owner_id": user["id"]}).to_list(1000)
        contact_ids = {c["contact_id"] for c in user_contacts}
        for pid in input.participant_ids:
            if pid != user["id"] and pid not in contact_ids:
                raise HTTPException(status_code=403, detail="Nur Kontakte können zu Gruppen hinzugefügt werden.")
    if not input.is_group and len(all_participants) == 2:
        existing = await db.chats.find_one({"is_group": False, "participant_ids": {"$all": [ObjectId(p) for p in all_participants], "$size": 2}})
        if existing:
            return {"chat": serialize_chat(existing)}
    chat_doc = {"name": input.name, "is_group": input.is_group, "participant_ids": [ObjectId(p) for p in all_participants], "created_by": ObjectId(user["id"]), "admin_ids": [user["id"]], "security_level": input.security_level, "group_role_map": input.group_role_map or {}, "created_at": datetime.now(timezone.utc), "last_message": None, "last_message_at": datetime.now(timezone.utc)}
    result = await db.chats.insert_one(chat_doc)
    chat_doc["_id"] = result.inserted_id
    return {"chat": serialize_chat(chat_doc)}

@api_router.get("/chats")
async def get_chats(user: dict = Depends(get_current_user)):
    """Chat list with minimized metadata — no participant details, no last message content"""
    chats = await db.chats.find({"participant_ids": ObjectId(user["id"])}).sort("last_message_at", -1).to_list(100)
    result = []
    for chat in chats:
        chat_data = serialize_chat(chat)
        # Metadata minimization: Only return participant count, not full details
        chat_data["participant_count"] = len(chat.get("participant_ids", []))
        # Remove participant_ids from list response (social graph protection)
        chat_data.pop("participant_ids", None)
        # Remove last_message content (already None from send_message)
        chat_data.pop("last_message", None)
        # Remove created_by (not needed in list)
        chat_data.pop("created_by", None)
        unread = await db.messages.count_documents({"chat_id": str(chat["_id"]), "sender_id": {"$ne": user["id"]}, "read_by": {"$nin": [user["id"]]}})
        chat_data["unread_count"] = unread
        result.append(chat_data)
    return {"chats": result}

@api_router.get("/chats/{chat_id}")
async def get_chat(chat_id: str, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    chat_data = serialize_chat(chat)
    participants = []
    for pid in chat.get("participant_ids", []):
        p = await db.users.find_one({"_id": pid}, {"password_hash": 0})
        if p: participants.append(serialize_user_public(p))
    chat_data["participants"] = participants
    return {"chat": chat_data}

@api_router.post("/chats/{chat_id}/leave")
async def leave_chat(chat_id: str, user: dict = Depends(get_current_user)):
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    if not chat.get("is_group"):
        raise HTTPException(status_code=400, detail="Einzelchats können nicht verlassen werden")
    await db.chats.update_one({"_id": oid}, {"$pull": {"participant_ids": ObjectId(user["id"])}})
    updated = await db.chats.find_one({"_id": oid})
    if updated and len(updated.get("participant_ids", [])) == 0:
        await db.chats.delete_one({"_id": oid})
        await db.messages.delete_many({"chat_id": chat_id})
    return {"message": "Gruppe verlassen"}

@api_router.post("/chats/{chat_id}/add-member")
async def add_group_member(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Add a member to a group (admin only)"""
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    if not chat.get("is_group"):
        raise HTTPException(status_code=400, detail="Nur bei Gruppen möglich")
    body = await request.json()
    contact_id = body.get("contact_id")
    if not contact_id:
        raise HTTPException(status_code=400, detail="contact_id erforderlich")
    user_contacts = await db.contacts.find({"owner_id": user["id"]}).to_list(1000)
    contact_ids = {c["contact_id"] for c in user_contacts}
    if contact_id not in contact_ids:
        raise HTTPException(status_code=403, detail="Nur Kontakte können hinzugefügt werden")
    if contact_id in [str(p) for p in chat.get("participant_ids", [])]:
        raise HTTPException(status_code=400, detail="Bereits Mitglied")
    await db.chats.update_one({"_id": oid}, {"$addToSet": {"participant_ids": ObjectId(contact_id)}})
    await ws_emit_to_chat(chat_id, 'chat:member_added', {'user_id': user["id"], 'added_id': contact_id, 'chat_id': chat_id})
    return {"message": "Mitglied hinzugefügt"}

@api_router.post("/chats/{chat_id}/remove-member")
async def remove_group_member(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Remove a member from a group (admin only)"""
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    if str(chat.get("created_by")) != user["id"] and user["id"] not in chat.get("admin_ids", []):
        raise HTTPException(status_code=403, detail="Nur Admins können Mitglieder entfernen")
    body = await request.json()
    member_id = body.get("member_id")
    if not member_id:
        raise HTTPException(status_code=400, detail="member_id erforderlich")
    if member_id == user["id"]:
        raise HTTPException(status_code=400, detail="Ersteller kann sich nicht selbst entfernen")
    await db.chats.update_one({"_id": oid}, {"$pull": {"participant_ids": ObjectId(member_id)}})
    await ws_emit_to_chat(chat_id, 'chat:member_removed', {'user_id': user["id"], 'removed_id': member_id, 'chat_id': chat_id})
    return {"message": "Mitglied entfernt"}

@api_router.post("/chats/{chat_id}/promote-admin")
async def promote_admin(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Promote a member to admin (creator only)"""
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    if str(chat.get("created_by")) != user["id"]:
        raise HTTPException(status_code=403, detail="Nur der Ersteller kann Admins ernennen")
    body = await request.json()
    member_id = body.get("member_id")
    if not member_id:
        raise HTTPException(status_code=400, detail="member_id erforderlich")
    if member_id not in [str(p) for p in chat.get("participant_ids", [])]:
        raise HTTPException(status_code=400, detail="Nur Mitglieder können Admin werden")
    await db.chats.update_one({"_id": oid}, {"$addToSet": {"admin_ids": member_id}})
    await ws_emit_to_chat(chat_id, 'chat:admin_promoted', {'user_id': user["id"], 'admin_id': member_id})
    return {"message": "Admin ernannt"}

@api_router.post("/chats/{chat_id}/demote-admin")
async def demote_admin(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Demote an admin to member (creator only)"""
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    if str(chat.get("created_by")) != user["id"]:
        raise HTTPException(status_code=403, detail="Nur der Ersteller kann Admins entfernen")
    body = await request.json()
    member_id = body.get("member_id")
    if not member_id:
        raise HTTPException(status_code=400, detail="member_id erforderlich")
    if member_id == user["id"]:
        raise HTTPException(status_code=400, detail="Ersteller kann sich nicht selbst degradieren")
    await db.chats.update_one({"_id": oid}, {"$pull": {"admin_ids": member_id}})
    await ws_emit_to_chat(chat_id, 'chat:admin_demoted', {'user_id': user["id"], 'admin_id': member_id})
    return {"message": "Admin degradiert"}

@api_router.get("/chats/{chat_id}/admins")
async def get_chat_admins(chat_id: str, user: dict = Depends(get_current_user)):
    """List all admins of a group"""
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    admin_ids = chat.get("admin_ids", [str(chat.get("created_by"))])
    admins = []
    for aid in admin_ids:
        u = await db.users.find_one({"_id": ObjectId(aid)}, {"password_hash": 0, "contacts": 0, "blocked_users": 0})
        if u:
            admin_data = serialize_user_public(u)
            admin_data["is_creator"] = aid == str(chat.get("created_by"))
            admins.append(admin_data)
    return {"admins": admins}

@api_router.put("/chats/{chat_id}")
async def update_chat(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Update group name or settings (admin only)"""
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    if str(chat.get("created_by")) != user["id"] and user["id"] not in chat.get("admin_ids", []):
        raise HTTPException(status_code=403, detail="Nur Admins können Einstellungen ändern")
    body = await request.json()
    updates = {}
    if "name" in body: updates["name"] = body["name"]
    if "security_level" in body: updates["security_level"] = body["security_level"]
    if updates:
        await db.chats.update_one({"_id": oid}, {"$set": updates})
    return {"message": "Chat aktualisiert"}

@api_router.post("/chats/{chat_id}/pin-message")
async def pin_message(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Pin a message to the top of the chat"""
    body = await request.json()
    message_id = body.get("message_id")
    if not message_id:
        raise HTTPException(status_code=400, detail="message_id erforderlich")
    msg = await db.messages.find_one({"_id": ObjectId(message_id), "chat_id": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    await db.chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {"pinned_message_id": message_id, "pinned_by": user["id"], "pinned_at": datetime.now(timezone.utc)}})
    await ws_emit_to_chat(chat_id, 'chat:pinned', {'message_id': message_id, 'chat_id': chat_id})
    return {"message": "Nachricht angeheftet"}

@api_router.post("/chats/{chat_id}/unpin-message")
async def unpin_message(chat_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Remove pinned message"""
    await db.chats.update_one({"_id": ObjectId(chat_id)}, {"$unset": {"pinned_message_id": "", "pinned_by": "", "pinned_at": ""}})
    await ws_emit_to_chat(chat_id, 'chat:unpinned', {'chat_id': chat_id})
    return {"message": "Anheften entfernt"}

@api_router.post("/messages/{message_id}/star")
async def star_message(message_id: str, user: dict = Depends(get_current_user)):
    """Star/unstar a message"""
    oid = validate_object_id(message_id)
    msg = await db.messages.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    chat = await db.chats.find_one({"_id": ObjectId(msg["chat_id"]), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=403, detail="Kein Zugriff")
    starred = msg.get("starred_by", [])
    if user["id"] in starred:
        starred.remove(user["id"])
    else:
        starred.append(user["id"])
    await db.messages.update_one({"_id": oid}, {"$set": {"starred_by": starred}})
    return {"message": "Stern aktualisiert", "starred": user["id"] in starred}

@api_router.get("/messages/starred/{chat_id}")
async def get_starred_messages(chat_id: str, user: dict = Depends(get_current_user)):
    """Get all starred messages in a chat"""
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    messages = await db.messages.find({"chat_id": chat_id, "starred_by": user["id"]}).sort("created_at", -1).to_list(100)
    return {"messages": [serialize_message(m) for m in messages]}

@api_router.get("/messages/search/{chat_id}")
async def search_messages(chat_id: str, q: str, user: dict = Depends(get_current_user)):
    """Search messages in a chat (only works for non-E2EE or client-side)"""
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    query = {"chat_id": chat_id, "content": {"$regex": q, "$options": "i"}}
    messages = await db.messages.find(query).sort("created_at", -1).limit(50).to_list(50)
    return {"messages": [serialize_message(m) for m in messages], "query": q}

@api_router.post("/messages/{message_id}/forward")
async def forward_message(message_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Forward a message to another chat"""
    oid = validate_object_id(message_id)
    msg = await db.messages.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    body = await request.json()
    target_chat_id = body.get("chat_id")
    if not target_chat_id:
        raise HTTPException(status_code=400, detail="chat_id erforderlich")
    target_chat = await db.chats.find_one({"_id": ObjectId(target_chat_id), "participant_ids": ObjectId(user["id"])})
    if not target_chat:
        raise HTTPException(status_code=404, detail="Ziel-Chat nicht gefunden")
    now = datetime.now(timezone.utc)
    fwd_content = f"↪️ Weitergeleitet: {msg.get('content', '')[:100]}"
    fwd_doc = {
        "chat_id": target_chat_id,
        "sender_id": user["id"],
        "sender_name": user.get("name", "Unbekannt"),
        "sender_callsign": user.get("callsign", ""),
        "content": fwd_content,
        "message_type": msg.get("message_type", "text"),
        "security_level": msg.get("security_level", "UNCLASSIFIED"),
        "media_base64": msg.get("media_base64"),
        "forwarded_from": msg["_id"],
        "forwarded_from_chat": msg["chat_id"],
        "forwarded_from_user": msg.get("sender_id"),
        "status": "sent",
        "delivered_to": [],
        "read_by": [user["id"]],
        "created_at": now,
        "encrypted": True,
    }
    result = await db.messages.insert_one(fwd_doc)
    fwd_doc["_id"] = result.inserted_id
    serialized = serialize_message(fwd_doc)
    await ws_emit_to_chat(target_chat_id, 'message:new', serialized)
    return {"message": serialized}

@api_router.post("/chats/{chat_id}/export")
async def export_chat(chat_id: str, user: dict = Depends(get_current_user)):
    """Export chat messages as JSON (client-side decryptable)"""
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    messages = await db.messages.find({"chat_id": chat_id}).sort("created_at", 1).to_list(10000)
    export_data = {
        "chat_id": chat_id,
        "chat_name": chat.get("name"),
        "is_group": chat.get("is_group"),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "message_count": len(messages),
        "messages": [serialize_message(m) for m in messages],
    }
    return {"export": export_data}

# ==================== MESSAGES ====================

@api_router.post("/messages")
async def send_message(input: MessageSend, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"_id": ObjectId(input.chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    now = datetime.now(timezone.utc)

    # Parse @mentions from content
    mentions = []
    if chat.get("is_group"):
        mention_pattern = re.compile(r'@([a-zA-Z0-9_\-\.]{3,30})')
        found_usernames = mention_pattern.findall(input.content)
        if found_usernames:
            participant_ids = [str(pid) for pid in chat.get("participant_ids", [])]
            mentioned_users = await db.users.find({"username": {"$in": [u.lower() for u in found_usernames]}}).to_list(100)
            for mu in mentioned_users:
                mu_id = str(mu["_id"])
                if mu_id in participant_ids and mu_id != user["id"]:
                    mentions.append(mu_id)

    msg_doc = {"chat_id": input.chat_id, "sender_id": user["id"], "sender_name": user.get("name", "Unbekannt"), "sender_callsign": user.get("callsign", ""), "content": input.content, "message_type": input.message_type, "security_level": input.security_level, "self_destruct_seconds": input.self_destruct_seconds, "self_destruct_at": (now + timedelta(seconds=input.self_destruct_seconds)) if input.self_destruct_seconds else None, "is_emergency": input.is_emergency, "media_base64": input.media_base64, "reply_to": input.reply_to, "mentions": mentions, "status": "sent", "delivered_to": [], "read_by": [user["id"]], "created_at": now, "encrypted": True}
    result = await db.messages.insert_one(msg_doc)
    preview = input.content[:50] if input.content else "[Medien]"
    if input.is_emergency: preview = "NOTFALL: " + preview
    await db.chats.update_one({"_id": ObjectId(input.chat_id)}, {"$set": {"last_message": preview, "last_message_at": now}})
    msg_doc["_id"] = result.inserted_id
    serialized = serialize_message(msg_doc)

    # Metadata minimization: Store only message type indicator, NOT content preview
    # The server should never see message content — even for E2EE messages, the type leaks metadata
    await db.chats.update_one({"_id": ObjectId(input.chat_id)}, {"$set": {
        "last_message": None,  # No plaintext preview — server sees nothing
        "last_message_at": now,
        "last_message_type": input.message_type,  # Only type (text/image/voice) — not content
    }})

    # WebSocket: Push new message to all chat participants in realtime
    await ws_emit_to_chat(input.chat_id, 'message:new', serialized)

    # WebSocket: Notify mentioned users
    for mentioned_user_id in mentions:
        await ws_emit_to_user(mentioned_user_id, 'message:mention', {
            "message": serialized,
            "from_user_id": user["id"],
            "from_username": user.get("username", ""),
            "chat_id": input.chat_id,
        })

    return {"message": serialized}

@api_router.get("/messages/{chat_id}")
async def get_messages(chat_id: str, limit: int = 50, before: Optional[str] = None, user: dict = Depends(get_current_user)):
    limit = min(max(limit, 1), 100)
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    query = {"chat_id": chat_id}
    if before: query["_id"] = {"$lt": ObjectId(before)}
    now = datetime.now(timezone.utc)
    await db.messages.delete_many({"chat_id": chat_id, "self_destruct_at": {"$lt": now, "$ne": None}})
    messages = await db.messages.find(query).sort("created_at", -1).limit(limit).to_list(limit)
    messages.reverse()
    msg_ids = [m["_id"] for m in messages if user["id"] not in m.get("delivered_to", [])]
    if msg_ids:
        await db.messages.update_many({"_id": {"$in": msg_ids}}, {"$addToSet": {"delivered_to": user["id"]}, "$set": {"status": "delivered"}})
    return {"messages": [serialize_message(m) for m in messages]}

@api_router.post("/messages/read")
async def mark_read(input: MessageAck, user: dict = Depends(get_current_user)):
    if len(input.message_ids) > 50:
        raise HTTPException(status_code=400, detail="Maximal 50 Nachrichten pro Request")
    for mid in input.message_ids:
        oid = validate_object_id(mid)
        msg = await db.messages.find_one({"_id": oid})
        if not msg: continue
        chat = await db.chats.find_one({"_id": ObjectId(msg["chat_id"]), "participant_ids": ObjectId(user["id"])})
        if not chat: continue
        await db.messages.update_one({"_id": oid}, {"$addToSet": {"read_by": user["id"]}})
    return {"message": "Nachrichten als gelesen markiert"}

@api_router.delete("/messages/{message_id}")
async def delete_message(message_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Delete message for everyone (within 24h) or for self"""
    oid = validate_object_id(message_id)
    msg = await db.messages.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    if msg["sender_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Nur eigene Nachrichten können gelöscht werden")
    # Delete for everyone within 24h, otherwise tombstone
    age_hours = (datetime.now(timezone.utc) - msg["created_at"]).total_seconds() / 3600
    if age_hours < 24:
        await db.messages.delete_one({"_id": oid})
        await ws_emit_to_chat(msg["chat_id"], 'message:deleted', {'message_id': message_id, 'chat_id': msg["chat_id"]})
    else:
        await db.messages.update_one({"_id": oid}, {"$set": {"content": "[Nachricht gelöscht]", "deleted": True}})
    await audit_log("message_deleted", user["id"])
    return {"message": "Nachricht gelöscht"}

class MessageEdit(BaseModel):
    content: str = Field(min_length=1, max_length=10000)

@api_router.put("/messages/{message_id}")
async def edit_message(message_id: str, input: MessageEdit, request: Request, user: dict = Depends(get_current_user)):
    """Edit own message (within 15 min)"""
    oid = validate_object_id(message_id)
    msg = await db.messages.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    if msg["sender_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Nur eigene Nachrichten können bearbeitet werden")
    age_min = (datetime.now(timezone.utc) - msg["created_at"]).total_seconds() / 60
    if age_min > 15:
        raise HTTPException(status_code=400, detail="Nachricht kann nur innerhalb von 15 Minuten bearbeitet werden")
    await db.messages.update_one({"_id": oid}, {"$set": {"content": input.content, "edited": True, "edited_at": datetime.now(timezone.utc)}})
    await ws_emit_to_chat(msg["chat_id"], 'message:edited', {'message_id': message_id, 'content': input.content, 'chat_id': msg["chat_id"]})
    return {"message": "Nachricht bearbeitet"}

class MessageReaction(BaseModel):
    emoji: str = Field(min_length=1, max_length=10)

@api_router.post("/messages/{message_id}/react")
async def add_reaction(message_id: str, input: MessageReaction, request: Request, user: dict = Depends(get_current_user)):
    """Add/remove reaction to a message"""
    oid = validate_object_id(message_id)
    msg = await db.messages.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    chat = await db.chats.find_one({"_id": ObjectId(msg["chat_id"]), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diesen Chat")
    # Toggle reaction
    reactions = msg.get("reactions", {})
    emoji_reactions = reactions.get(input.emoji, [])
    if user["id"] in emoji_reactions:
        emoji_reactions.remove(user["id"])
        if not emoji_reactions:
            del reactions[input.emoji]
        else:
            reactions[input.emoji] = emoji_reactions
    else:
        reactions[input.emoji] = emoji_reactions + [user["id"]]
    await db.messages.update_one({"_id": oid}, {"$set": {"reactions": reactions}})
    await ws_emit_to_chat(msg["chat_id"], 'message:reaction', {'message_id': message_id, 'reactions': reactions, 'chat_id': msg["chat_id"]})
    return {"message": "Reaktion aktualisiert", "reactions": reactions}

@api_router.get("/messages/poll/{chat_id}")
async def poll_messages(chat_id: str, after: Optional[str] = None, user: dict = Depends(get_current_user)):
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": validate_object_id(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    now = datetime.now(timezone.utc)
    await db.messages.delete_many({"chat_id": chat_id, "self_destruct_at": {"$lt": now, "$ne": None}})
    query: dict = {"chat_id": chat_id}
    if after:
        try: query["_id"] = {"$gt": ObjectId(after)}
        except (InvalidId, TypeError): pass
    messages = await db.messages.find(query).sort("created_at", 1).to_list(100)
    return {"messages": [serialize_message(m) for m in messages]}

@api_router.get("/messages/mentions")
async def get_my_mentions(user: dict = Depends(get_current_user)):
    """Alle Nachrichten zurückgeben, in denen der aktuelle Benutzer erwähnt wurde"""
    messages = await db.messages.find({"mentions": user["id"]}).sort("created_at", -1).to_list(100)
    return {"messages": [serialize_message(m) for m in messages]}

@api_router.get("/messages/mentions/unread-count")
async def get_unread_mentions_count(user: dict = Depends(get_current_user)):
    """Anzahl der ungelesenen Erwähnungen für den aktuellen Benutzer"""
    count = await db.messages.count_documents({"mentions": user["id"], "read_by": {"$nin": [user["id"]]}})
    return {"unread_count": count}

@api_router.get("/chats/poll/updates")
async def poll_chat_updates(user: dict = Depends(get_current_user)):
    chats = await db.chats.find({"participant_ids": ObjectId(user["id"])}).sort("last_message_at", -1).to_list(100)
    result = []
    for chat in chats:
        chat_data = serialize_chat(chat)
        participants = []
        for pid in chat.get("participant_ids", []):
            p = await db.users.find_one({"_id": pid}, {"password_hash": 0, "contacts": 0, "blocked_users": 0})
            if p: participants.append(serialize_user_public(p))
        chat_data["participants"] = participants
        unread = await db.messages.count_documents({"chat_id": str(chat["_id"]), "sender_id": {"$ne": user["id"]}, "read_by": {"$nin": [user["id"]]}})
        chat_data["unread_count"] = unread
        result.append(chat_data)
    return {"chats": result}

# ==================== POLLS ====================

@api_router.post("/chats/{chat_id}/polls")
async def create_poll(chat_id: str, input: PollCreate, user: dict = Depends(get_current_user)):
    """Umfrage in einem Chat erstellen"""
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    now = datetime.now(timezone.utc)
    poll_data = {
        "question": input.question,
        "options": input.options,
        "votes": [],
    }
    msg_doc = {
        "chat_id": chat_id,
        "sender_id": user["id"],
        "sender_name": user.get("name", "Unbekannt"),
        "sender_callsign": user.get("callsign", ""),
        "content": input.question,
        "message_type": "poll",
        "security_level": "UNCLASSIFIED",
        "poll_data": poll_data,
        "status": "sent",
        "delivered_to": [],
        "read_by": [user["id"]],
        "created_at": now,
        "encrypted": False,
    }
    result = await db.messages.insert_one(msg_doc)
    msg_doc["_id"] = result.inserted_id
    serialized = serialize_message(msg_doc)
    await ws_emit_to_chat(chat_id, 'message:new', serialized)
    return {"poll": serialized}

@api_router.get("/chats/{chat_id}/polls")
async def list_polls(chat_id: str, user: dict = Depends(get_current_user)):
    """Alle Umfragen in einem Chat auflisten"""
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    polls = await db.messages.find({"chat_id": chat_id, "message_type": "poll"}).sort("created_at", -1).to_list(100)
    return {"polls": [serialize_message(p) for p in polls]}

@api_router.post("/polls/{poll_id}/vote")
async def vote_poll(poll_id: str, input: PollVote, user: dict = Depends(get_current_user)):
    """Für eine Umfrage-Option abstimmen"""
    oid = validate_object_id(poll_id)
    msg = await db.messages.find_one({"_id": oid, "message_type": "poll"})
    if not msg:
        raise HTTPException(status_code=404, detail="Umfrage nicht gefunden")
    chat = await db.chats.find_one({"_id": ObjectId(msg["chat_id"]), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diesen Chat")
    poll_data = msg.get("poll_data", {})
    options = poll_data.get("options", [])
    if input.option_index >= len(options):
        raise HTTPException(status_code=400, detail="Ungültiger Options-Index")
    votes = poll_data.get("votes", [])
    # Remove existing vote from this user if any
    votes = [v for v in votes if v.get("user_id") != user["id"]]
    # Add new vote
    votes.append({"option_index": input.option_index, "user_id": user["id"]})
    await db.messages.update_one({"_id": oid}, {"$set": {"poll_data.votes": votes}})
    # Fetch updated message
    updated_msg = await db.messages.find_one({"_id": oid})
    serialized = serialize_message(updated_msg)
    await ws_emit_to_chat(msg["chat_id"], 'poll:voted', {
        "poll_id": poll_id,
        "chat_id": msg["chat_id"],
        "votes": serialized.get("poll_data", {}).get("votes", []),
    })
    return {"message": "Stimme abgegeben", "poll": serialized}

@api_router.get("/polls/{poll_id}")
async def get_poll(poll_id: str, user: dict = Depends(get_current_user)):
    """Umfrage-Ergebnisse abrufen (anonymisiert - ohne wer für was gestimmt hat)"""
    oid = validate_object_id(poll_id)
    msg = await db.messages.find_one({"_id": oid, "message_type": "poll"})
    if not msg:
        raise HTTPException(status_code=404, detail="Umfrage nicht gefunden")
    chat = await db.chats.find_one({"_id": ObjectId(msg["chat_id"]), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diesen Chat")
    poll_data = msg.get("poll_data", {})
    # Anonymize votes: only return counts per option
    votes = poll_data.get("votes", [])
    option_counts = [0] * len(poll_data.get("options", []))
    total_votes = len(votes)
    for v in votes:
        idx = v.get("option_index", 0)
        if idx < len(option_counts):
            option_counts[idx] += 1
    result = {
        "id": str(msg["_id"]),
        "question": poll_data.get("question"),
        "options": poll_data.get("options", []),
        "option_counts": option_counts,
        "total_votes": total_votes,
        "created_at": msg["created_at"].isoformat() if isinstance(msg["created_at"], datetime) else msg["created_at"],
        "created_by": msg.get("sender_id"),
    }
    return {"poll": result}

# ==================== TYPING ====================

@api_router.post("/typing/{chat_id}")
async def set_typing(chat_id: str, user: dict = Depends(get_current_user)):
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": validate_object_id(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    await db.typing.update_one({"chat_id": chat_id, "user_id": user["id"]}, {"$set": {"user_id": user["id"], "chat_id": chat_id, "name": user.get("name", ""), "at": datetime.now(timezone.utc)}}, upsert=True)
    return {"ok": True}

@api_router.get("/typing/{chat_id}")
async def get_typing(chat_id: str, user: dict = Depends(get_current_user)):
    oid = validate_object_id(chat_id)
    chat = await db.chats.find_one({"_id": oid, "participant_ids": validate_object_id(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=5)
    typers = await db.typing.find({"chat_id": chat_id, "user_id": {"$ne": user["id"]}, "at": {"$gt": cutoff}}).to_list(10)
    return {"typing": [{"user_id": t["user_id"], "name": t["name"]} for t in typers]}

@api_router.get("/health")
async def health():
    return {"status": "ok", "service": "SS-Note", "timestamp": datetime.now(timezone.utc).isoformat()}

# ==================== USERNAME GENERATOR ====================

@api_router.get("/auth/generate-username")
async def gen_username():
    """Generate a random anonymous username"""
    for _ in range(10):
        candidate = generate_username()
        existing = await db.users.find_one({"username": candidate})
        if not existing:
            return {"username": candidate}
    return {"username": generate_username() + secrets.token_hex(2)}

# ==================== REFRESH TOKEN ====================

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    """Issue new access token using refresh token"""
    token = request.cookies.get("refresh_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Kein Refresh-Token")
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        blacklisted = await db.token_blacklist.find_one({"token_hash": token_hash})
        if blacklisted:
            raise HTTPException(status_code=401, detail="Token widerrufen")
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Kein Refresh-Token")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="Benutzer nicht gefunden")
        # Issue new access token + ROTATE refresh token (invalidate old)
        user_id = str(user["_id"])
        new_access = create_access_token(user_id)
        new_refresh = create_refresh_token(user_id)
        # Blacklist old refresh token
        old_hash = hashlib.sha256(token.encode()).hexdigest()
        await db.token_blacklist.insert_one({"token_hash": old_hash, "user_id": user_id, "blacklisted_at": datetime.now(timezone.utc), "expires_at": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)})
        response.set_cookie(key="access_token", value=new_access, **cookie_kwargs(), max_age=ACCESS_TOKEN_MINUTES*60)
        response.set_cookie(key="refresh_token", value=new_refresh, **cookie_kwargs(), max_age=REFRESH_TOKEN_DAYS*86400)
        return {"token": new_access, "user": serialize_user(user)}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh-Token abgelaufen")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ungültiger Refresh-Token")

# ==================== ACCOUNT DELETION (DSGVO) ====================

@api_router.delete("/auth/account")
async def delete_account(request: Request, response: Response, user: dict = Depends(get_current_user)):
    """DSGVO: Vollständige Account-Löschung"""
    uid = user["id"]
    await db.messages.delete_many({"sender_id": uid})
    await db.contacts.delete_many({"$or": [{"owner_id": uid}, {"contact_id": uid}]})
    await db.chats.update_many({"participant_ids": ObjectId(uid)}, {"$pull": {"participant_ids": ObjectId(uid)}})
    empty = await db.chats.find({"participant_ids": {"$size": 0}}).to_list(1000)
    for c in empty:
        await db.messages.delete_many({"chat_id": str(c["_id"])})
        await db.chats.delete_one({"_id": c["_id"]})
    await db.typing.delete_many({"user_id": uid})
    await db.users.delete_one({"_id": ObjectId(uid)})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    client_ip = request.client.host if request.client else "unknown"
    await audit_log("account_deleted", uid)
    return {"message": "Account und alle Daten gelöscht"}

# ==================== QR MAGIC LINKS (Device-to-Device) ====================

import qrcode
import io
import base64

@api_router.post("/auth/magic-qr")
async def create_magic_qr(request: Request, user: dict = Depends(get_current_user)):
    """Generate QR code for cross-device login. Scanned device gets auto-logged in."""
    magic_token = secrets.token_urlsafe(32)
    await db.magic_tokens.insert_one({
        "token": magic_token,
        "user_id": user["id"],
        "username": user.get("username", ""),
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        "used": False,
    })
    # Build QR data: URL with magic token
    qr_url = f"{FRONTEND_URL}/magic-login?token={magic_token}"
    # Generate QR as base64 PNG
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(qr_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#2D5A3D", back_color="#080C0A")
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    qr_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    
    await audit_log("magic_qr_created", user["id"])
    return {"qr_base64": f"data:image/png;base64,{qr_base64}", "token": magic_token, "expires_in": 300}

@api_router.post("/auth/magic-verify")
async def verify_magic_token(request: Request, response: Response):
    """Verify a magic QR token and issue JWT. Called by the scanning device."""
    body = await request.json()
    magic_token = body.get("token", "")
    if not magic_token:
        raise HTTPException(status_code=400, detail="Kein Magic-Token")
    
    doc = await db.magic_tokens.find_one({"token": magic_token, "used": False})
    if not doc:
        raise HTTPException(status_code=401, detail="Ungültiger oder abgelaufener Token")
    
    expires = doc.get("expires_at")
    if expires:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            await db.magic_tokens.delete_one({"token": magic_token})
            raise HTTPException(status_code=401, detail="Token abgelaufen")
    
    # Mark as used
    await db.magic_tokens.update_one({"token": magic_token}, {"$set": {"used": True}})
    
    user_id = doc["user_id"]
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, **cookie_kwargs(), max_age=ACCESS_TOKEN_MINUTES*60)
    response.set_cookie(key="refresh_token", value=refresh_token, **cookie_kwargs(), max_age=REFRESH_TOKEN_DAYS*86400)
    
    client_ip = request.client.host if request.client else "unknown"
    await audit_log("magic_login", user_id, {"via": "qr_scan"})
    return {"user": serialize_user(user), "token": access_token}

# Socket.IO: Notify original device when QR is scanned
@sio.event
async def magic_qr_poll(sid, data):
    """Original device polls to check if QR was scanned"""
    session = await sio.get_session(sid)
    if not session:
        return
    token = data.get("token")
    if not token:
        return
    doc = await db.magic_tokens.find_one({"token": token, "user_id": session["user_id"]})
    if doc and doc.get("used"):
        await sio.emit("magic_qr_verified", {"success": True}, to=sid)

# ==================== E2EE: KEY MANAGEMENT ====================

@api_router.post("/keys/upload")
async def upload_public_key(input: PublicKeyUpload, request: Request, user: dict = Depends(get_current_user)):
    """Upload user's E2EE public key (X25519, base64-encoded)"""
    if not BASE64_REGEX.match(input.public_key):
        raise HTTPException(status_code=400, detail="Ungültiger Public Key")
    await db.user_keys.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "public_key": input.public_key,
            "fingerprint": input.fingerprint,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True
    )
    await audit_log("key_uploaded", user["id"])
    return {"message": "Public key gespeichert"}

@api_router.get("/keys/{user_id}")
async def get_user_key(user_id: str, user: dict = Depends(get_current_user)):
    """Get another user's public key for E2EE session initialization"""
    key_doc = await db.user_keys.find_one({"user_id": user_id})
    if not key_doc:
        raise HTTPException(status_code=404, detail="Public key nicht gefunden")
    return {
        "user_id": user_id,
        "public_key": key_doc["public_key"],
        "fingerprint": key_doc.get("fingerprint"),
        "updated_at": key_doc.get("updated_at"),
    }

@api_router.get("/keys/batch")
async def get_user_keys_batch(user_ids: str, user: dict = Depends(get_current_user)):
    """Get multiple users' public keys in one request"""
    ids = [uid.strip() for uid in user_ids.split(",") if uid.strip()]
    keys = await db.user_keys.find({"user_id": {"$in": ids}}).to_list(100)
    result = {}
    for k in keys:
        result[k["user_id"]] = {
            "public_key": k["public_key"],
            "fingerprint": k.get("fingerprint"),
        }
    return {"keys": result}

# ==================== E2EE: PREKEY BUNDLES (X3DH) ====================

class PrekeyBundleUpload(BaseModel):
    signed_prekey_id: str
    signed_prekey: str  # base64
    signature: str  # base64 — Ed25519 signature of signed_prekey
    identity_key: str  # base64 — Ed25519 signing public key
    one_time_prekeys: List[dict] = []  # [{id: str, key: str (base64)}]

@api_router.post("/keys/prekeys")
async def upload_prekeys(input: PrekeyBundleUpload, request: Request, user: dict = Depends(get_current_user)):
    """Upload X3DH prekey bundle: signed prekey + optional one-time prekeys"""
    if not BASE64_REGEX.match(input.signed_prekey):
        raise HTTPException(status_code=400, detail="Ungültiger Signed Prekey")
    if not BASE64_REGEX.match(input.signature):
        raise HTTPException(status_code=400, detail="Ungültige Signatur")
    if not BASE64_REGEX.match(input.identity_key):
        raise HTTPException(status_code=400, detail="Ungültiger Identity Key")

    # Validate OTP keys
    for otp in input.one_time_prekeys:
        if not BASE64_REGEX.match(otp.get("key", "")):
            raise HTTPException(status_code=400, detail=f"Ungültiger One-Time Prekey: {otp.get('id')}")

    await db.user_keys.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "signed_prekey_id": input.signed_prekey_id,
            "signed_prekey": input.signed_prekey,
            "signature": input.signature,
            "identity_key": input.identity_key,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True
    )

    # Store one-time prekeys (upsert, max 100)
    if input.one_time_prekeys:
        existing_otps = await db.prekeys.find({"user_id": user["id"], "type": "otp"}).to_list(200)
        existing_ids = {k["otp_id"] for k in existing_otps}
        new_otps = []
        for otp in input.one_time_prekeys:
            if otp["id"] not in existing_ids:
                new_otps.append({
                    "user_id": user["id"],
                    "otp_id": otp["id"],
                    "key": otp["key"],
                    "type": "otp",
                    "created_at": datetime.now(timezone.utc),
                })
        if new_otps:
            # Cap total OTPs at 100
            total = len(existing_otps) + len(new_otps)
            if total > 100:
                new_otps = new_otps[:100 - len(existing_otps)]
            await db.prekeys.insert_many(new_otps)

    await audit_log("prekeys_uploaded", user["id"])
    return {"message": "Prekeys gespeichert", "count": len(input.one_time_prekeys)}

@api_router.get("/keys/prekeys/{user_id}")
async def get_prekey_bundle(user_id: str, user: dict = Depends(get_current_user)):
    """Get another user's X3DH prekey bundle for session initialization"""
    key_doc = await db.user_keys.find_one({"user_id": user_id})
    if not key_doc:
        raise HTTPException(status_code=404, detail="Public key nicht gefunden")

    # Fetch available one-time prekeys (limit 10)
    otps = await db.prekeys.find({"user_id": user_id, "type": "otp"}).sort("created_at", 1).to_list(10)

    return {
        "user_id": user_id,
        "identity_key": key_doc.get("identity_key", key_doc.get("public_key")),
        "signed_prekey_id": key_doc.get("signed_prekey_id"),
        "signed_prekey": key_doc.get("signed_prekey"),
        "signature": key_doc.get("signature"),
        "one_time_prekeys": [{"id": o["otp_id"], "key": o["key"]} for o in otps],
    }

@api_router.delete("/keys/prekeys/{user_id}/{otp_id}")
async def consume_prekey(user_id: str, otp_id: str, user: dict = Depends(get_current_user)):
    """Mark a one-time prekey as consumed (called by sender after using it)"""
    await db.prekeys.delete_one({"user_id": user_id, "otp_id": otp_id, "type": "otp"})
    return {"message": "Prekey verbraucht"}

# ==================== PUSH NOTIFICATIONS (E2EE-safe) ====================

@api_router.post("/push/register")
async def register_push_token(input: PushTokenUpload, request: Request, user: dict = Depends(get_current_user)):
    """Register device push token for E2EE notifications. Server never sees message content."""
    await db.push_tokens.update_one(
        {"user_id": user["id"], "platform": input.platform},
        {"$set": {
            "push_token": input.push_token,
            "platform": input.platform,
            "registered_at": datetime.now(timezone.utc),
            "last_used": None,
        }},
        upsert=True
    )
    await audit_log("push_registered", user["id"], {"platform": input.platform})
    return {"message": "Push-Token registriert"}

@api_router.delete("/push/unregister")
async def unregister_push_token(request: Request, user: dict = Depends(get_current_user)):
    """Remove push token for current device"""
    await db.push_tokens.delete_many({"user_id": user["id"]})
    await audit_log("push_unregistered", user["id"])
    return {"message": "Push-Token entfernt"}

async def send_push_notification(user_id: str, chat_name: str = None):
    """Send E2EE-safe push notification. Never includes message content."""
    tokens = await db.push_tokens.find({"user_id": user_id}).to_list(10)
    if not tokens:
        return
    
    # E2EE-safe: Only notify that a new encrypted message arrived
    # NEVER include message content, sender name, or any metadata
    notification = {
        "to": [],
        "title": "SS-Note",
        "body": "Neue verschlüsselte Nachricht",
        "data": {
            "type": "encrypted_message",
            "chat_id": chat_name,
        },
        "sound": "default",
        "priority": "high",
    }
    
    for t in tokens:
        notification["to"].append(t["push_token"])
    
    # Send via Expo Push API (works for both iOS and Android via Expo)
    try:
        import httpx
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://exp.host/--/api/v2/push/send",
                json=notification,
                timeout=10,
            )
            if resp.status_code == 200:
                await db.push_tokens.update_many(
                    {"user_id": user_id},
                    {"$set": {"last_used": datetime.now(timezone.utc)}}
                )
    except Exception as e:
        logger.warning(f"Push notification failed: {e}")

# ==================== E2EE: ENCRYPTED MESSAGES ====================

@api_router.post("/messages/encrypted")
async def send_encrypted_message(input: EncryptedMessageSend, user: dict = Depends(get_current_user)):
    """Send an E2EE encrypted message. Backend only sees ciphertext. Supports 1:1 and group chats."""
    chat = await db.chats.find_one({"_id": ObjectId(input.chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    
    if not BASE64_REGEX.match(input.ciphertext) or not BASE64_REGEX.match(input.nonce):
        raise HTTPException(status_code=400, detail="Ungültige verschlüsselte Daten")
    
    if input.media_ciphertext and not BASE64_REGEX.match(input.media_ciphertext):
        raise HTTPException(status_code=400, detail="Ungültige verschlüsselte Medien-Daten")
    
    now = datetime.now(timezone.utc)
    msg_doc = {
        "chat_id": input.chat_id,
        "sender_id": user["id"],
        "sender_name": user.get("name", "Unbekannt"),
        "sender_callsign": user.get("callsign", ""),
        "content": input.ciphertext,
        "nonce": input.nonce,
        "dh_public": input.dh_public,
        "msg_num": input.msg_num,
        "message_type": input.message_type,
        "security_level": input.security_level,
        "self_destruct_seconds": input.self_destruct_seconds,
        "self_destruct_at": (now + timedelta(seconds=input.self_destruct_seconds)) if input.self_destruct_seconds else None,
        "is_emergency": input.is_emergency,
        "media_ciphertext": input.media_ciphertext,
        "media_nonce": input.media_nonce,
        "sender_key_id": input.sender_key_id,
        "sender_key_iteration": input.sender_key_iteration,
        "reply_to": input.reply_to,
        "status": "sent",
        "delivered_to": [],
        "read_by": [user["id"]],
        "created_at": now,
        "encrypted": True,
        "e2ee": True,
    }
    result = await db.messages.insert_one(msg_doc)
    msg_doc["_id"] = result.inserted_id
    serialized = serialize_message(msg_doc)
    
    await ws_emit_to_chat(input.chat_id, 'message:new', serialized)
    
    # Push notification for offline participants (E2EE-safe: no content)
    other_participants = [pid for pid in chat.get("participant_ids", []) if str(pid) != user["id"]]
    for pid in other_participants:
        await send_push_notification(str(pid), input.chat_id)
    
    return {"message": serialized}

# ==================== STARTUP ====================

@app.on_event("startup")
async def startup():
    await db.users.create_index("username", unique=True)
    await db.users.create_index("add_me_code", unique=True, sparse=True)
    await db.contacts.create_index([("owner_id", 1), ("contact_id", 1)], unique=True)
    await db.contact_requests.create_index([("requester_id", 1), ("target_id", 1)])
    await db.contact_requests.create_index("target_id")
    await db.chats.create_index("participant_ids")
    await db.messages.create_index([("chat_id", 1), ("created_at", -1)])
    await db.messages.create_index("self_destruct_at", expireAfterSeconds=0)
    await db.messages.create_index("mentions")
    await db.messages.create_index([("message_type", 1), ("chat_id", 1)])
    await db.typing.create_index("at", expireAfterSeconds=10)
    await db.login_attempts.create_index("identifier")
    await db.login_attempts.create_index("locked_until", expireAfterSeconds=900)
    await db.token_blacklist.create_index("token_hash")
    await db.token_blacklist.create_index("expires_at", expireAfterSeconds=0)
    await db.audit_log.create_index("timestamp")
    await db.audit_log.create_index("expires_at", expireAfterSeconds=0)  # TTL: auto-delete after 30 days
    await db.magic_tokens.create_index("token")
    await db.magic_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.user_keys.create_index("user_id", unique=True)
    await db.push_tokens.create_index([("user_id", 1), ("platform", 1)])
    
    # Seed anonymous demo users
    for udata in [
        {"username": "wolf-1", "password": "Funk2024!", "name": "Kommandant Wolf", "callsign": "WOLF-1", "role": "commander", "add_me_code": "FUNK-W0LF01"},
        {"username": "adler-2", "password": "Funk2024!", "name": "Funker Adler", "callsign": "ADLER-2", "role": "officer", "add_me_code": "FUNK-ADL3R2"},
    ]:
        existing = await db.users.find_one({"username": udata["username"]})
        if not existing:
            await db.users.insert_one({
                "username": udata["username"],
                "password_hash": hash_password(udata["password"]),
                "name": udata["name"],
                "callsign": udata["callsign"],
                "role": udata["role"],
                "add_me_code": udata.get("add_me_code", generate_add_code()),
                "add_me_code_updated_at": datetime.now(timezone.utc),
                "status": "online",
                "status_text": "Einsatzbereit",
                "avatar_base64": None,
                "trust_level": "VERIFIED",
                "contacts": [],
                "blocked_users": [],
                "created_at": datetime.now(timezone.utc),
                "last_seen": datetime.now(timezone.utc),
            })
            logger.info("User erstellt: %s", udata["username"])
    
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    creds_path.write_text("""# SS-Note Test Credentials (ANONYMOUS AUTH)

## Admin Account
- Username: wolf-1
- Passkey: Funk2024!
- Role: commander

## Test Account
- Username: adler-2
- Passkey: Funk2024!
- Role: officer

## Auth Endpoints (Username + Passkey — NO EMAIL)
- POST /api/auth/register {username, passkey, name, callsign?}
- POST /api/auth/login {username, passkey}
- POST /api/auth/logout
- POST /api/auth/change-passkey {old_passkey, new_passkey}
- GET /api/auth/me
""")
    logger.info("SS-Note Server gestartet (Anonyme Auth)!")

@app.on_event("shutdown")
async def shutdown():
    client.close()

app.include_router(api_router)

allowed_origins = [FRONTEND_URL] if FRONTEND_URL != "*" else ["*"]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
