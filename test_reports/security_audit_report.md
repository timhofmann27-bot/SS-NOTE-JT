# 🔍 444.HEIMAT-FUNK — Vollständiger QA & Security Audit Report

**Datum:** 2026-03-30  
**Auditor:** Senior QA Engineer / Penetration Tester  
**Scope:** Backend API, Frontend UI, Datenbank, Architektur, Sicherheit  
**Methode:** Automatisierte + manuelle Tests, aktive Angriffssimulation

---

## 📊 ZUSAMMENFASSUNG

| Kategorie | Anzahl |
|-----------|--------|
| 🔴 KRITISCH | 3 |
| 🟠 MITTEL | 26 |
| 🟡 GERING | 11 |
| ℹ️ INFO | 5 |
| **GESAMT** | **45 Findings** |

### Gesamtbewertung: **5.5 / 10**

> Das System bietet gute Grundfunktionalität und solide IDOR-Abwehr auf den Haupt-Endpoints.
> Es hat jedoch **3 kritische Sicherheitslücken**, die vor einem Produktionsbetrieb zwingend behoben werden müssen.
> Für einen Messenger, der "Sicherheit first" verspricht, fehlen fundamentale Validierungen.

---

## 🔴 KRITISCHE BUGS & SICHERHEITSLÜCKEN (3)

### BUG-001: KEIN RATE LIMITING — Brute-Force möglich
- **Endpoint:** `POST /api/auth/login`
- **Beschreibung:** 15+ fehlgeschlagene Login-Versuche werden nicht blockiert. Ein Angreifer kann unbegrenzt Passwörter ausprobieren.
- **Reproduktion:** 15x Login mit falschem Passwort → kein 429 Status
- **Impact:** Vollständige Kontokompromittierung bei schwachen Passwörtern
- **Fix:** Rate Limiting mit MongoDB `login_attempts` Collection (5 Versuche → 15min Sperre)
- **Datei:** `server.py` → Login-Endpoint

### BUG-002: IDOR auf Message-Polling — Fremde Nachrichten lesbar
- **Endpoint:** `GET /api/messages/poll/{chat_id}`
- **Beschreibung:** Der Polling-Endpoint prüft NICHT, ob der Benutzer Teilnehmer des Chats ist. Jeder authentifizierte Benutzer kann durch Erraten/Kennen der Chat-ID fremde Nachrichten mitlesen.
- **Reproduktion:**
  1. User A erstellt Chat mit User B
  2. User C (nicht im Chat) ruft `GET /api/messages/poll/{chat_id}` auf
  3. User C erhält alle Nachrichten des fremden Chats
- **Impact:** **Vollständiger Vertraulichkeitsverlust** — Das Hauptversprechen (E2E-Verschlüsselung) ist faktisch wertlos
- **Fix:** Chat-Zugehörigkeitsprüfung hinzufügen (wie bei `GET /api/messages/{chat_id}`)
- **Datei:** `server.py:454-464`

### BUG-003: CORS Wildcard mit Credentials
- **Konfiguration:** `allow_origins=["*"]` + `allow_credentials=True`
- **Beschreibung:** Obwohl Browser den `*`+`credentials` Combo blockieren, ist dies eine unsichere Konfiguration. Bei manchen Proxies/CDNs wird der Header nicht korrekt gehandhabt.
- **Fix:** Explizite Frontend-URL in `allow_origins` setzen
- **Datei:** `server.py:592-598`

---

## 🟠 MITTLERE BUGS (26)

### Eingabe-Validierung (8 Issues)

| # | Problem | Details |
|---|---------|---------|
| M-01 | Keine Passwort-Mindestlänge | Leeres Passwort `""` wird akzeptiert |
| M-02 | Keine Passwort-Komplexität | Passwort `"1"`, `"ab"`, `"123"` werden akzeptiert |
| M-03 | Keine E-Mail-Validierung | `"notanemail"`, `"@@@"`, `"test@"`, `""` werden akzeptiert |
| M-04 | Leere Nachrichten möglich | Leere Strings und Whitespace-Nachrichten werden gespeichert |
| M-05 | Keine Nachrichtenlänge-Begrenzung | 100KB und 1MB Nachrichten werden akzeptiert |
| M-06 | 5MB Base64 Payload akzeptiert | Keine Größenbeschränkung für media_base64 |
| M-07 | Negativer Self-Destruct-Timer | `-1` Sekunden wird akzeptiert (undefiniertes Verhalten) |
| M-08 | Keine Enum-Validierung für Security/Trust-Level | `"ULTRA_TOP_SECRET"` und `"ADMIN_HACKED"` werden akzeptiert |

### Sicherheit (6 Issues)

| # | Problem | Details |
|---|---------|---------|
| M-09 | Typing-Indicator auf fremden Chats | Jeder kann in jedem Chat "tippt..." anzeigen |
| M-10 | Information Disclosure: Alle E-Mails sichtbar | GET /api/users zeigt alle E-Mails aller Benutzer |
| M-11 | Keine Request-Body-Größenbeschränkung | DoS durch riesige Payloads möglich |
| M-12 | Server 500 bei ungültigen ObjectIds | `GET /api/chats/invalid` gibt 500 statt 400/404 |
| M-13 | Server 500 bei SQL-Injection-ähnlichen IDs | `' OR 1=1 --` als ID crasht den Server |
| M-14 | Server 500 bei Null-Byte in IDs | `\x00` als ID crasht den Server |

### Performance/Architektur (7 Issues)

| # | Problem | Details |
|---|---------|---------|
| M-15 | N+1 Query auf GET /api/chats | Pro Chat einzelne DB-Abfragen für Teilnehmer |
| M-16 | N+1 Query auf GET /api/contacts | Pro Kontakt einzelne DB-Abfrage |
| M-17 | Kein Pagination auf GET /api/users | Max 500 Benutzer auf einmal |
| M-18 | Auth-Token nur im RAM | Bei Seiten-Reload/App-Neustart → automatischer Logout |
| M-19 | Polling läuft im Hintergrund | 2s-Interval auch bei inaktiver App → Battery-Drain |
| M-20 | Keine Offline-Erkennung | App zeigt keine Fehler bei Netzwerkverlust |

### Logik (5 Issues — zusammengefasst aus M-01 bis M-04)

| # | Problem | Details |
|---|---------|---------|
| M-21 | Registrierung mit leerem Namen | Name `""` wird akzeptiert |
| M-22 | Kein Schutz vor Massen-Registrierung | Kein CAPTCHA oder Registrierungs-Limit |
| M-23 | Chat ohne Kontaktbeziehung | Jeder kann mit jedem chatten |
| M-24 | Kein Token-Revocation nach Logout | JWT bleibt gültig bis Ablauf |
| M-25 | Doppelte Kontakt-Logik | Reverse-Contact wird automatisch erstellt → Consent fehlt |

---

## 🟡 GERINGE BUGS (11)

| # | Problem |
|---|---------|
| L-01 | Kontaktlisten anderer Benutzer sichtbar |
| L-02 | Leere/Whitespace Nachrichten werden gespeichert |
| L-03 | Kein Health-Check Endpoint |
| L-04 | `on_event('startup')` deprecated → `lifespan` nutzen |
| L-05 | Token in Response-Body UND Cookie (doppelte Angriffsfläche) |
| L-06 | Kein Pull-to-Refresh auf Chat-Liste |
| L-07 | Kein Error-Boundary im Frontend |
| L-08 | Deprecated `shadow*` Style-Props |
| L-09 | Kein Bestätigungsdialog bei Logout |
| L-10 | Nachrichten-FlatList scrollToEnd bei jedem Render |
| L-11 | Extrem großer Self-Destruct-Timer (999999999s) akzeptiert |

---

## ℹ️ INFORMATIONEN (5)

| # | Info |
|---|------|
| I-01 | XSS-Payloads werden unverändert in DB gespeichert (React escapet, aber kein Server-Sanitizing) |
| I-02 | Kein Refresh-Token-Endpoint implementiert |
| I-03 | Kein Passwort-Ändern/Vergessen-Endpoint |
| I-04 | Nur Polling (2s), keine WebSocket-Architektur |
| I-05 | FlatList-Performance bei langen Nachrichtenlisten |

---

## 🧪 TEST-COVERAGE ANALYSE

### Vorhandene Tests (20 Tests)
- ✅ Auth: Login, Register, Me, Logout (7 Tests)
- ✅ Users/Contacts: List, Get, Add, Update Profile (5 Tests)
- ✅ Chats/Messages: CRUD, Emergency (8 Tests)

### Fehlende Tests (15 identifiziert)
- ❌ Brute-Force / Rate Limiting
- ❌ IDOR auf `/messages/poll/{chat_id}`
- ❌ Ungültige ObjectIds (500er Fehler)
- ❌ Passwort-Mindestlänge/-Stärke
- ❌ E-Mail-Validierung
- ❌ Leere Nachrichten
- ❌ Nachrichten-Längenlimit
- ❌ Self-Destruct-Timer Validierung
- ❌ Security-Level Whitelist
- ❌ Trust-Level Whitelist
- ❌ Cross-User Chat-Zugriff
- ❌ Concurrency (gleichzeitige Benutzer)
- ❌ Nachrichtenpersistenz nach Neustart
- ❌ Frontend E2E Nachrichtenversand
- ❌ Logout + Token-Invalidierung

**Test-Coverage-Bewertung: ~40%** (nur Happy-Path getestet, keine Negative/Edge Cases)

---

## 🏗️ ARCHITEKTUR-BEWERTUNG

### Backend (6/10)
**Positiv:**
- Saubere Router-Struktur mit Prefix `/api`
- Pydantic Models für Input-Validierung
- Async MongoDB mit Motor
- Korrekte ObjectId-Serialisierung
- Gute Index-Strategie

**Negativ:**
- Monolithische `server.py` (600+ Zeilen, sollte in Module aufgeteilt werden)
- N+1 Queries bei Chats und Kontakten
- Keine Service-Layer-Trennung (Logik direkt in Endpoints)
- Keine Middleware für Auth/Validation
- Keine Fehlerbehandlung für ungültige ObjectIds

### Frontend (7/10)
**Positiv:**
- Saubere Expo Router File-Based Navigation
- Konsistentes Theme-System
- Zentralisierte API-Schicht
- AuthContext mit Loading-States
- Gute testID-Coverage

**Negativ:**
- Token nur im RAM (kein SecureStore)
- Kein Offline-Handling
- Keine Error-Boundaries
- Polling statt WebSockets

### Datenbank (7/10)
**Positiv:**
- Sinnvolle Indexes
- TTL-Index für Typing und Self-Destruct
- Unique-Constraints auf Email und Contacts

**Negativ:**
- Keine Schema-Validierung (MongoDB Schema Validation)
- Kein Connection-Pooling-Tuning
- Keine Backup-Strategie

---

## 🏆 TOP 5 VERBESSERUNGEN (Priorität)

### 1. 🔴 IDOR-Fix auf Message-Polling (SOFORT)
```python
# server.py:454 - Chat-Zugehörigkeitsprüfung hinzufügen:
@api_router.get("/messages/poll/{chat_id}")
async def poll_messages(chat_id: str, ...):
    chat = await db.chats.find_one({
        "_id": ObjectId(chat_id), 
        "participant_ids": ObjectId(user["id"])
    })
    if not chat:
        raise HTTPException(status_code=404)
```

### 2. 🔴 Rate Limiting implementieren (SOFORT)
```python
# login_attempts Collection mit IP+Email Tracking
# 5 Fehlversuche → 15 Minuten Sperre
```

### 3. 🟠 Input-Validierung verschärfen (HOCH)
```python
class RegisterInput(BaseModel):
    email: EmailStr  # pydantic email-validator
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=100)

class MessageSend(BaseModel):
    content: str = Field(min_length=1, max_length=10000)
    security_level: Literal["UNCLASSIFIED","RESTRICTED","CONFIDENTIAL","SECRET"]
    self_destruct_seconds: Optional[int] = Field(ge=5, le=604800)
```

### 4. 🟠 ObjectId-Fehlerbehandlung (HOCH)
```python
from bson.errors import InvalidId
# Wrapper oder Middleware die InvalidId catcht → 400 statt 500
```

### 5. 🟠 WebSocket statt Polling (MITTEL)
```python
# FastAPI WebSocket für Echtzeit-Nachrichten
# Reduziert DB-Load von ~30 Queries/min/User auf ~0
```

---

## 🎯 GESAMTBEWERTUNG

| Bereich | Note | Details |
|---------|------|---------|
| Funktionalität | 8/10 | Alle Kernfeatures funktionieren, CRUD stabil |
| Sicherheit | 4/10 | 3 kritische Lücken, keine Input-Validierung |
| Performance | 7/10 | Schnelle Antwortzeiten, aber N+1 Queries |
| Test-Coverage | 4/10 | Nur Happy-Path, keine Security/Edge Tests |
| Architektur | 6/10 | Solide Basis, aber monolithisch |
| UX/Design | 8/10 | Konsistentes Theme, gute Mobile-UX |
| Code-Qualität | 6/10 | Lesbar, aber keine Separation of Concerns |
| **GESAMT** | **5.5/10** | **Guter MVP, aber nicht produktionsreif für Security-App** |

---

## ⚡ HACKER-PERSPEKTIVE: So würde ich das System brechen

1. **Brute Force Attack:** Passwort-Dictionary gegen `/api/auth/login` laufen lassen (kein Rate Limit!)
2. **Message Sniffing:** Alle Chat-IDs erraten/enumerieren und über `/messages/poll/{id}` mitlesen
3. **DoS:** 100MB-Nachrichten senden bis Speicher voll
4. **Spam:** 1000 Accounts ohne E-Mail-Verifizierung erstellen
5. **Social Engineering:** Über `/api/users` alle E-Mails auslesen

> **Fazit:** Für einen Messenger, der "militärische Sicherheit" verspricht, müssen die 3 kritischen und die Top-10 mittleren Issues behoben werden, bevor das System auch nur für interne Tests genutzt wird.
