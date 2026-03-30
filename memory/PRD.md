# 444.HEIMAT-FUNK — Product Requirements Document

## Übersicht
444.HEIMAT-FUNK ist ein militärisch-orientierter, sicherer Messaging-Dienst mit **anonymer Authentifizierung**. Keine E-Mail, keine Telefonnummer — nur Username + Passkey. DSGVO-konform by Design.

## Technischer Stack
- **Frontend**: React Native (Expo SDK 54) mit Expo Router
- **Backend**: FastAPI (Python) mit Motor (async MongoDB)
- **Datenbank**: MongoDB (heimatfunk_db)
- **Authentifizierung**: Anonym — Username + Passkey (bcrypt) + JWT

## Auth-System: Anonym (Username + Passkey)
- **Keine personenbezogenen Daten**: Kein Email, kein Telefon, kein Realname nötig
- **Username**: 3-30 Zeichen, frei wählbar (a-z, 0-9, _, -, .)
- **Passkey**: Min. 8 Zeichen, bcrypt-gehasht gespeichert
- **JWT Token**: Nur user_id im Payload (keine E-Mail)
- **Token-Blacklist**: Logout invalidiert Token sofort (MongoDB TTL)
- **Rate Limiting**: 5 Versuche/IP + 3 Registrierungen/min/IP

## Kernfunktionen
- 1:1 Chats & Gruppenchats mit Echtzeit-Polling
- Lesebestätigungen, Typing-Indikatoren
- 4 Sicherheitsklassifizierungen (OFFEN/VS-NfD/VS-VERTRAULICH/GEHEIM)
- Selbstzerstörende Nachrichten, NOTFALL-Kanal
- Militärische Rollen (Kommandant/Offizier/Soldat)
- Kontakt-Check bei Gruppenerstellung
- Nachricht löschen, Gruppe verlassen
- Security Audit-Log

## API-Endpunkte
### Auth (Anonym)
- POST /api/auth/register {username, passkey, name, callsign?}
- POST /api/auth/login {username, passkey}
- POST /api/auth/logout
- POST /api/auth/change-passkey {old_passkey, new_passkey}
- GET /api/auth/me

### Messaging
- POST /api/messages, GET /api/messages/{chat_id}
- POST /api/messages/read, DELETE /api/messages/{id}
- GET /api/messages/poll/{chat_id}

### Chats & Contacts
- POST /api/chats, GET /api/chats, POST /api/chats/{id}/leave
- POST /api/contacts/add, GET /api/contacts, DELETE /api/contacts/{id}

## Security (3 Pentest-Runden)
- JWT Secret: 128-Zeichen zufällig
- CORS: Nur Frontend-URL
- IDOR: Alle Endpoints mit Chat-Membership-Check
- Input Validation: Pydantic mit Whitelists
- Rate Limiting: Atomic findOneAndUpdate
- Token Blacklist bei Logout
