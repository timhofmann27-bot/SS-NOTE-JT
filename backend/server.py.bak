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
db = client[os.environ.get('DB_NAME', 'heimatfunk_db')]

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET or len(JWT_SECRET) < 64:
    JWT_SECRET = secrets.token_hex(64)
    logger.warning("JWT_SECRET zu kurz — generiere zufälligen 128-char Secret.")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60       # 1h statt 24h (Security Upgrade)
REFRESH_TOKEN_DAYS = 7          # 7 Tage statt 30

FRONTEND_URL = os.environ.get('FRONTEND_URL', os.environ.get('EXPO_PUBLIC_BACKEND_URL', '*'))
BCRYPT_ROUNDS = 12              # Erhöht von Default 10

app = FastAPI(title="444.HEIMAT-FUNK API", docs_url=None, redoc_url=None)
api_router = APIRouter(prefix="/api")

# ==================== WEBSOCKET: Real-time messaging ====================
import socketio

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*', logger=False)

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
VALID_MESSAGE_TYPES = ["text", "image", "voice", "file", "system"]
USERNAME_REGEX = re.compile(r'^[a-zA-Z0-9_\-\.]{3,30}$')
BASE64_REGEX = re.compile(r'^[A-Za-z0-9+/]*={0,2}$')

def validate_object_id(oid: str) -> ObjectId:
    try:
        return ObjectId(oid)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Ungültige ID")

def anonymize_ip(ip: str) -> str:
    """Hash IP for privacy — never store raw IPs"""
    return hashlib.sha256(ip.encode()).hexdigest()[:16]

async def audit_log(action: str, user_id: str = None, ip: str = None, details: dict = None):
    """Security audit with anonymized IP (never stores raw IP)"""
    await db.audit_log.insert_one({
        "action": action,
        "user_id": user_id,
        "ip_hash": anonymize_ip(ip) if ip else None,  # ANONYMIZED — no raw IP
        "details": details or {},
        "timestamp": datetime.now(timezone.utc),
    })

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

# ==================== AUTH (ANONYMOUS — Username + Passkey) ====================

@api_router.post("/auth/register")
async def register(input: RegisterInput, request: Request, response: Response):
    username = input.username.strip().lower()
    client_ip = request.client.host if request.client else "unknown"
    
    # Rate limit
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
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_MINUTES*60, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_DAYS*86400, path="/")
    
    await audit_log("register", user_id, client_ip, {"username": username})
    
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
        await audit_log("login_failed", None, client_ip, {"username": username})
        raise HTTPException(status_code=401, detail="Ungültige Anmeldedaten")
    
    if not verify_password(input.passkey, user["password_hash"]):
        await _track_failed_login(identifier)
        await audit_log("login_failed", str(user["_id"]), client_ip, {"username": username})
        raise HTTPException(status_code=401, detail="Ungültige Anmeldedaten")
    
    await db.login_attempts.delete_one({"identifier": identifier})
    user_id = str(user["_id"])
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"status": "online", "last_seen": datetime.now(timezone.utc)}})
    
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_MINUTES*60, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_DAYS*86400, path="/")
    
    await audit_log("login_success", user_id, client_ip, {"username": username})
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
    await audit_log("logout", user["id"], request.client.host if request.client else "unknown")
    return {"message": "Abgemeldet"}

@api_router.post("/auth/change-passkey")
async def change_passkey(input: PasskeyChange, request: Request, user: dict = Depends(get_current_user)):
    full_user = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not full_user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    if not verify_password(input.old_passkey, full_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Alter Passkey ist falsch")
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"password_hash": hash_password(input.new_passkey)}})
    await audit_log("passkey_change", user["id"], request.client.host if request.client else "unknown")
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
    await audit_log("add_code_reset", user["id"], client_ip)
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
    
    # Rate limit: 5 code attempts/min
    rl_key = f"addcode:{anonymize_ip(client_ip)}"
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
    
    await audit_log("contact_request_sent", user["id"], client_ip, {"target_id": target_id})
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
    await audit_log("contact_accepted", user["id"], client_ip, {"requester_id": requester_id})
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
    await audit_log("contact_removed", user["id"], client_ip, {"contact_id": contact_id})
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
    chat_doc = {"name": input.name, "is_group": input.is_group, "participant_ids": [ObjectId(p) for p in all_participants], "created_by": ObjectId(user["id"]), "security_level": input.security_level, "group_role_map": input.group_role_map or {}, "created_at": datetime.now(timezone.utc), "last_message": None, "last_message_at": datetime.now(timezone.utc)}
    result = await db.chats.insert_one(chat_doc)
    chat_doc["_id"] = result.inserted_id
    return {"chat": serialize_chat(chat_doc)}

@api_router.get("/chats")
async def get_chats(user: dict = Depends(get_current_user)):
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

# ==================== MESSAGES ====================

@api_router.post("/messages")
async def send_message(input: MessageSend, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"_id": ObjectId(input.chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    now = datetime.now(timezone.utc)
    msg_doc = {"chat_id": input.chat_id, "sender_id": user["id"], "sender_name": user.get("name", "Unbekannt"), "sender_callsign": user.get("callsign", ""), "content": input.content, "message_type": input.message_type, "security_level": input.security_level, "self_destruct_seconds": input.self_destruct_seconds, "self_destruct_at": (now + timedelta(seconds=input.self_destruct_seconds)) if input.self_destruct_seconds else None, "is_emergency": input.is_emergency, "media_base64": input.media_base64, "status": "sent", "delivered_to": [], "read_by": [user["id"]], "created_at": now, "encrypted": True}
    result = await db.messages.insert_one(msg_doc)
    preview = input.content[:50] if input.content else "[Medien]"
    if input.is_emergency: preview = "NOTFALL: " + preview
    await db.chats.update_one({"_id": ObjectId(input.chat_id)}, {"$set": {"last_message": preview, "last_message_at": now}})
    msg_doc["_id"] = result.inserted_id
    serialized = serialize_message(msg_doc)
    
    # WebSocket: Push new message to all chat participants in realtime
    await ws_emit_to_chat(input.chat_id, 'message:new', serialized)
    
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
async def delete_message(message_id: str, user: dict = Depends(get_current_user)):
    oid = validate_object_id(message_id)
    msg = await db.messages.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
    if msg["sender_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Nur eigene Nachrichten können gelöscht werden")
    await db.messages.delete_one({"_id": oid})
    return {"message": "Nachricht gelöscht"}

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
    return {"status": "ok", "service": "444.HEIMAT-FUNK", "timestamp": datetime.now(timezone.utc).isoformat()}

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
        response.set_cookie(key="access_token", value=new_access, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_MINUTES*60, path="/")
        response.set_cookie(key="refresh_token", value=new_refresh, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_DAYS*86400, path="/")
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
    await audit_log("account_deleted", uid, client_ip)
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
    
    await audit_log("magic_qr_created", user["id"], request.client.host if request.client else "unknown")
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
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_MINUTES*60, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_DAYS*86400, path="/")
    
    client_ip = request.client.host if request.client else "unknown"
    await audit_log("magic_login", user_id, client_ip, {"via": "qr_scan"})
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
    await db.typing.create_index("at", expireAfterSeconds=10)
    await db.login_attempts.create_index("identifier")
    await db.login_attempts.create_index("locked_until", expireAfterSeconds=900)
    await db.token_blacklist.create_index("token_hash")
    await db.token_blacklist.create_index("expires_at", expireAfterSeconds=0)
    await db.audit_log.create_index("timestamp")
    await db.magic_tokens.create_index("token")
    await db.magic_tokens.create_index("expires_at", expireAfterSeconds=0)
    
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
    creds_path.write_text("""# 444.HEIMAT-FUNK Test Credentials (ANONYMOUS AUTH)

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
    logger.info("444.HEIMAT-FUNK Server gestartet (Anonyme Auth)!")

@app.on_event("shutdown")
async def shutdown():
    client.close()

app.include_router(api_router)

allowed_origins = [FRONTEND_URL] if FRONTEND_URL != "*" else ["*"]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
