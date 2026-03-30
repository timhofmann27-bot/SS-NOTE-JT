# 444.HEIMAT-FUNK - Product Requirements Document

## Übersicht
444.HEIMAT-FUNK ist ein militärisch-orientierter, sicherer Messaging-Dienst mit deutschem Bezug. Die Anwendung kombiniert Sicherheitsstandards von Signal/Threema mit einer Architektur für organisierte Kommunikation in militärischen und defensiven Kontexten.

## Technischer Stack
- **Frontend**: React Native (Expo SDK 54) mit Expo Router
- **Backend**: FastAPI (Python) mit Motor (async MongoDB)
- **Datenbank**: MongoDB (heimatfunk_db)
- **Authentifizierung**: JWT (Bearer Token) + bcrypt Password Hashing

## Kernfunktionen (MVP - Phase 1)

### Authentifizierung
- Registrierung mit Name, Rufzeichen, E-Mail, Passwort
- Login mit E-Mail/Passwort
- JWT-basierte Session-Verwaltung (24h Access Token)
- Automatische Admin/Test-User Seeding

### Messaging
- 1:1 Einzelchats (verschlüsselt)
- Gruppenchats mit bis zu 50+ Teilnehmern
- Echtzeit-Polling (2s Intervall) für neue Nachrichten
- Nachrichtenbestätigungen (gesendet, zugestellt, gelesen)
- Typing-Indikatoren
- Datums-Separatoren

### Sicherheitsfeatures
- Verschlüsselungsindikatoren (Lock-Icons) an jeder Nachricht
- Sicherheitsklassifizierungen: OFFEN, VS-NfD, VS-VERTRAULICH, GEHEIM
- Selbstzerstörende Nachrichten (Timer-basiert)
- NOTFALL-Nachrichten (Emergency Channel)
- Trust-Level für Kontakte (VERIFIED/UNVERIFIED)

### Militärische Features
- Hierarchische Rollen: Kommandant, Offizier, Soldat
- Rufzeichen-System (Callsigns)
- Sicherheitsstufen pro Chat und Nachricht
- Rollenbasierte Badges

### Kontakte
- Kontaktliste mit Trust-Levels
- Benutzersuche und -hinzufügen
- Online/Offline Status
- Rollenzuweisung

### Profil
- Bearbeitbares Profil (Name, Rufzeichen, Status)
- Sicherheitsstatus-Übersicht
- E2E-Verschlüsselung, X3DH, PFS Anzeige

## Design
- Dark Military Theme (#080C0A, #111916, #1A2420)
- German Military Green Accent (#2D5A3D, #3A7A52)
- Komplett deutschsprachig
- Minimalistisch, funktional, Dark Mode Standard

## API-Endpunkte
- POST /api/auth/register, /api/auth/login, /api/auth/logout
- GET /api/auth/me
- PUT /api/profile
- GET /api/users, /api/users/:id
- GET/POST /api/contacts, DELETE /api/contacts/:id
- GET/POST /api/chats, GET /api/chats/:id
- GET/POST /api/messages, POST /api/messages/read
- GET /api/messages/poll/:chatId
- GET/POST /api/typing/:chatId

## Nächste Phasen
- Phase 2: WebSocket-Echtzeit, Voice/Video Calls, Desktop-Client
- Phase 3: Mesh-Netzwerk, Audit-Logs, Enterprise-Tools
