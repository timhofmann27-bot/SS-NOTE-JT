from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import bcrypt
import jwt
import secrets
import json
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'heimatfunk_db')]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET', secrets.token_hex(32))
JWT_ALGORITHM = "HS256"

app = FastAPI(title="444.HEIMAT-FUNK API")
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

class RegisterInput(BaseModel):
    email: str
    password: str
    name: str
    callsign: Optional[str] = None

class LoginInput(BaseModel):
    email: str
    password: str

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    callsign: Optional[str] = None
    status_text: Optional[str] = None
    avatar_base64: Optional[str] = None

class ContactAdd(BaseModel):
    user_id: str
    trust_level: str = "UNVERIFIED"

class ChatCreate(BaseModel):
    participant_ids: List[str]
    name: Optional[str] = None
    is_group: bool = False
    group_role_map: Optional[dict] = None
    security_level: str = "UNCLASSIFIED"

class MessageSend(BaseModel):
    chat_id: str
    content: str
    message_type: str = "text"
    security_level: str = "UNCLASSIFIED"
    self_destruct_seconds: Optional[int] = None
    is_emergency: bool = False
    media_base64: Optional[str] = None

class MessageAck(BaseModel):
    message_ids: List[str]

# ==================== HELPERS ====================

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(hours=24), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30), "type": "refresh"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert")
    try:
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
        if isinstance(v, datetime):
            u[k] = v.isoformat()
        if isinstance(v, ObjectId):
            u[k] = str(v)
    return u

def serialize_message(msg: dict) -> dict:
    m = {**msg}
    if "_id" in m:
        m["id"] = str(m["_id"])
        del m["_id"]
    for k, v in m.items():
        if isinstance(v, datetime):
            m[k] = v.isoformat()
        if isinstance(v, ObjectId):
            m[k] = str(v)
    return m

def serialize_chat(chat: dict) -> dict:
    c = {**chat}
    if "_id" in c:
        c["id"] = str(c["_id"])
        del c["_id"]
    for k, v in c.items():
        if isinstance(v, datetime):
            c[k] = v.isoformat()
        if isinstance(v, ObjectId):
            c[k] = str(v)
    if "participant_ids" in c:
        c["participant_ids"] = [str(p) for p in c["participant_ids"]]
    return c

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register")
async def register(input: RegisterInput, response: Response):
    email = input.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="E-Mail bereits registriert")
    
    user_doc = {
        "email": email,
        "password_hash": hash_password(input.password),
        "name": input.name,
        "callsign": input.callsign or input.name.upper()[:6],
        "role": "soldier",
        "status": "online",
        "status_text": "Bereit",
        "avatar_base64": None,
        "trust_level": "VERIFIED",
        "contacts": [],
        "blocked_users": [],
        "created_at": datetime.now(timezone.utc),
        "last_seen": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=2592000, path="/")
    
    user_doc["id"] = user_id
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    for k, v in user_doc.items():
        if isinstance(v, datetime):
            user_doc[k] = v.isoformat()
    
    return {"user": user_doc, "token": access_token}

@api_router.post("/auth/login")
async def login(input: LoginInput, response: Response):
    email = input.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=401, detail="Ungültige Anmeldedaten")
    
    if not verify_password(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Ungültige Anmeldedaten")
    
    user_id = str(user["_id"])
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"status": "online", "last_seen": datetime.now(timezone.utc)}})
    
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=2592000, path="/")
    
    return {"user": serialize_user(user), "token": access_token}

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"user": user}

@api_router.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"status": "offline", "last_seen": datetime.now(timezone.utc)}})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Abgemeldet"}

# ==================== USER / PROFILE ====================

@api_router.put("/profile")
async def update_profile(input: ProfileUpdate, user: dict = Depends(get_current_user)):
    updates = {}
    if input.name is not None:
        updates["name"] = input.name
    if input.callsign is not None:
        updates["callsign"] = input.callsign
    if input.status_text is not None:
        updates["status_text"] = input.status_text
    if input.avatar_base64 is not None:
        updates["avatar_base64"] = input.avatar_base64
    if updates:
        await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": updates})
    updated = await db.users.find_one({"_id": ObjectId(user["id"])}, {"password_hash": 0})
    return {"user": serialize_user(updated)}

@api_router.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    users = await db.users.find({"_id": {"$ne": ObjectId(user["id"])}}, {"password_hash": 0}).to_list(500)
    return {"users": [serialize_user(u) for u in users]}

@api_router.get("/users/{user_id}")
async def get_user(user_id: str, user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    return {"user": serialize_user(u)}

# ==================== CONTACTS ====================

@api_router.post("/contacts/add")
async def add_contact(input: ContactAdd, user: dict = Depends(get_current_user)):
    target = await db.users.find_one({"_id": ObjectId(input.user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    
    existing = await db.contacts.find_one({"owner_id": user["id"], "contact_id": input.user_id})
    if existing:
        raise HTTPException(status_code=400, detail="Kontakt bereits vorhanden")
    
    contact_doc = {
        "owner_id": user["id"],
        "contact_id": input.user_id,
        "trust_level": input.trust_level,
        "added_at": datetime.now(timezone.utc),
    }
    await db.contacts.insert_one(contact_doc)
    
    # Also add reverse contact
    reverse = await db.contacts.find_one({"owner_id": input.user_id, "contact_id": user["id"]})
    if not reverse:
        await db.contacts.insert_one({
            "owner_id": input.user_id,
            "contact_id": user["id"],
            "trust_level": "UNVERIFIED",
            "added_at": datetime.now(timezone.utc),
        })
    
    return {"message": "Kontakt hinzugefügt"}

@api_router.get("/contacts")
async def get_contacts(user: dict = Depends(get_current_user)):
    contacts = await db.contacts.find({"owner_id": user["id"]}).to_list(500)
    result = []
    for c in contacts:
        u = await db.users.find_one({"_id": ObjectId(c["contact_id"])}, {"password_hash": 0})
        if u:
            user_data = serialize_user(u)
            user_data["trust_level"] = c.get("trust_level", "UNVERIFIED")
            result.append(user_data)
    return {"contacts": result}

@api_router.delete("/contacts/{contact_id}")
async def remove_contact(contact_id: str, user: dict = Depends(get_current_user)):
    await db.contacts.delete_one({"owner_id": user["id"], "contact_id": contact_id})
    return {"message": "Kontakt entfernt"}

# ==================== CHATS ====================

@api_router.post("/chats")
async def create_chat(input: ChatCreate, user: dict = Depends(get_current_user)):
    all_participants = list(set([user["id"]] + input.participant_ids))
    
    # For 1:1, check if chat already exists
    if not input.is_group and len(all_participants) == 2:
        existing = await db.chats.find_one({
            "is_group": False,
            "participant_ids": {"$all": [ObjectId(p) for p in all_participants], "$size": 2}
        })
        if existing:
            return {"chat": serialize_chat(existing)}
    
    chat_doc = {
        "name": input.name,
        "is_group": input.is_group,
        "participant_ids": [ObjectId(p) for p in all_participants],
        "created_by": ObjectId(user["id"]),
        "security_level": input.security_level,
        "group_role_map": input.group_role_map or {},
        "created_at": datetime.now(timezone.utc),
        "last_message": None,
        "last_message_at": datetime.now(timezone.utc),
    }
    result = await db.chats.insert_one(chat_doc)
    chat_doc["_id"] = result.inserted_id
    return {"chat": serialize_chat(chat_doc)}

@api_router.get("/chats")
async def get_chats(user: dict = Depends(get_current_user)):
    chats = await db.chats.find({"participant_ids": ObjectId(user["id"])}).sort("last_message_at", -1).to_list(100)
    result = []
    for chat in chats:
        chat_data = serialize_chat(chat)
        # Get participant info
        participants = []
        for pid in chat.get("participant_ids", []):
            p = await db.users.find_one({"_id": pid}, {"password_hash": 0, "contacts": 0, "blocked_users": 0})
            if p:
                participants.append(serialize_user(p))
        chat_data["participants"] = participants
        
        # Get unread count
        unread = await db.messages.count_documents({
            "chat_id": str(chat["_id"]),
            "sender_id": {"$ne": user["id"]},
            "read_by": {"$nin": [user["id"]]}
        })
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
        if p:
            participants.append(serialize_user(p))
    chat_data["participants"] = participants
    return {"chat": chat_data}

# ==================== MESSAGES ====================

@api_router.post("/messages")
async def send_message(input: MessageSend, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"_id": ObjectId(input.chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    
    now = datetime.now(timezone.utc)
    msg_doc = {
        "chat_id": input.chat_id,
        "sender_id": user["id"],
        "sender_name": user.get("name", "Unbekannt"),
        "sender_callsign": user.get("callsign", ""),
        "content": input.content,
        "message_type": input.message_type,
        "security_level": input.security_level,
        "self_destruct_seconds": input.self_destruct_seconds,
        "self_destruct_at": (now + timedelta(seconds=input.self_destruct_seconds)) if input.self_destruct_seconds else None,
        "is_emergency": input.is_emergency,
        "media_base64": input.media_base64,
        "status": "sent",
        "delivered_to": [],
        "read_by": [user["id"]],
        "created_at": now,
        "encrypted": True,
    }
    result = await db.messages.insert_one(msg_doc)
    
    # Update chat's last message
    preview = input.content[:50] if input.content else "[Medien]"
    if input.is_emergency:
        preview = "🚨 NOTFALL: " + preview
    await db.chats.update_one(
        {"_id": ObjectId(input.chat_id)},
        {"$set": {"last_message": preview, "last_message_at": now}}
    )
    
    msg_doc["_id"] = result.inserted_id
    return {"message": serialize_message(msg_doc)}

@api_router.get("/messages/{chat_id}")
async def get_messages(chat_id: str, limit: int = 50, before: Optional[str] = None, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "participant_ids": ObjectId(user["id"])})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat nicht gefunden")
    
    query = {"chat_id": chat_id}
    if before:
        query["_id"] = {"$lt": ObjectId(before)}
    
    # Clean up self-destructing messages
    now = datetime.now(timezone.utc)
    await db.messages.delete_many({"chat_id": chat_id, "self_destruct_at": {"$lt": now, "$ne": None}})
    
    messages = await db.messages.find(query).sort("created_at", -1).limit(limit).to_list(limit)
    messages.reverse()
    
    # Mark as delivered
    msg_ids = [m["_id"] for m in messages if user["id"] not in m.get("delivered_to", [])]
    if msg_ids:
        await db.messages.update_many(
            {"_id": {"$in": msg_ids}},
            {"$addToSet": {"delivered_to": user["id"]}, "$set": {"status": "delivered"}}
        )
    
    return {"messages": [serialize_message(m) for m in messages]}

@api_router.post("/messages/read")
async def mark_read(input: MessageAck, user: dict = Depends(get_current_user)):
    for mid in input.message_ids:
        await db.messages.update_one(
            {"_id": ObjectId(mid)},
            {"$addToSet": {"read_by": user["id"]}}
        )
    # Update status to read if all participants have read
    return {"message": "Nachrichten als gelesen markiert"}

@api_router.get("/messages/poll/{chat_id}")
async def poll_messages(chat_id: str, after: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"chat_id": chat_id}
    if after:
        try:
            query["_id"] = {"$gt": ObjectId(after)}
        except Exception:
            pass
    
    messages = await db.messages.find(query).sort("created_at", 1).to_list(100)
    return {"messages": [serialize_message(m) for m in messages]}

@api_router.get("/chats/poll/updates")
async def poll_chat_updates(user: dict = Depends(get_current_user)):
    """Get all chats with latest info for polling"""
    chats = await db.chats.find({"participant_ids": ObjectId(user["id"])}).sort("last_message_at", -1).to_list(100)
    result = []
    for chat in chats:
        chat_data = serialize_chat(chat)
        participants = []
        for pid in chat.get("participant_ids", []):
            p = await db.users.find_one({"_id": pid}, {"password_hash": 0, "contacts": 0, "blocked_users": 0})
            if p:
                participants.append(serialize_user(p))
        chat_data["participants"] = participants
        unread = await db.messages.count_documents({
            "chat_id": str(chat["_id"]),
            "sender_id": {"$ne": user["id"]},
            "read_by": {"$nin": [user["id"]]}
        })
        chat_data["unread_count"] = unread
        result.append(chat_data)
    return {"chats": result}

# ==================== TYPING INDICATOR ====================

@api_router.post("/typing/{chat_id}")
async def set_typing(chat_id: str, user: dict = Depends(get_current_user)):
    await db.typing.update_one(
        {"chat_id": chat_id, "user_id": user["id"]},
        {"$set": {"user_id": user["id"], "chat_id": chat_id, "name": user.get("name", ""), "at": datetime.now(timezone.utc)}},
        upsert=True
    )
    return {"ok": True}

@api_router.get("/typing/{chat_id}")
async def get_typing(chat_id: str, user: dict = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=5)
    typers = await db.typing.find({"chat_id": chat_id, "user_id": {"$ne": user["id"]}, "at": {"$gt": cutoff}}).to_list(10)
    return {"typing": [{"user_id": t["user_id"], "name": t["name"]} for t in typers]}

# ==================== STARTUP ====================

@app.on_event("startup")
async def startup():
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.contacts.create_index([("owner_id", 1), ("contact_id", 1)], unique=True)
    await db.chats.create_index("participant_ids")
    await db.messages.create_index([("chat_id", 1), ("created_at", -1)])
    await db.messages.create_index("self_destruct_at", expireAfterSeconds=0)
    await db.typing.create_index("at", expireAfterSeconds=10)
    
    # Seed demo users
    admin_email = os.environ.get("ADMIN_EMAIL", "kommandant@heimatfunk.de")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Funk2024!")
    
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Kommandant Wolf",
            "callsign": "WOLF-1",
            "role": "commander",
            "status": "online",
            "status_text": "Einsatzbereit",
            "avatar_base64": None,
            "trust_level": "VERIFIED",
            "contacts": [],
            "blocked_users": [],
            "created_at": datetime.now(timezone.utc),
            "last_seen": datetime.now(timezone.utc),
        })
        logger.info("Admin-Benutzer erstellt: %s", admin_email)
    
    # Create test user
    test_email = "funker@heimatfunk.de"
    test_password = "Funk2024!"
    test_existing = await db.users.find_one({"email": test_email})
    if not test_existing:
        await db.users.insert_one({
            "email": test_email,
            "password_hash": hash_password(test_password),
            "name": "Funker Adler",
            "callsign": "ADLER-2",
            "role": "officer",
            "status": "online",
            "status_text": "Auf Empfang",
            "avatar_base64": None,
            "trust_level": "VERIFIED",
            "contacts": [],
            "blocked_users": [],
            "created_at": datetime.now(timezone.utc),
            "last_seen": datetime.now(timezone.utc),
        })
        logger.info("Test-Benutzer erstellt: %s", test_email)
    
    # Write credentials
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    creds_path.write_text(f"""# 444.HEIMAT-FUNK Test Credentials

## Admin Account
- Email: {admin_email}
- Password: {admin_password}
- Role: commander

## Test Account
- Email: {test_email}
- Password: {test_password}
- Role: officer

## Auth Endpoints
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
""")
    logger.info("444.HEIMAT-FUNK Server gestartet!")

@app.on_event("shutdown")
async def shutdown():
    client.close()

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
