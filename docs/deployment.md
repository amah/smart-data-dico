# Deployment Modes & Architecture

Smart Data Dictionary supports two deployment modes: **Desktop** (local, single-user) and **Server** (remote, multi-user). The mode is determined by the `PROFILE` environment variable.

## Deployment Modes Overview

```
                  Desktop Mode                    Server Mode
                  ────────────                    ───────────
Profile           local (default)                 team | server
Auth              None (auto-admin)               JWT + login page
Users             Single user                     Multi-user with roles
Data location     Local directory (--data-dir)     Server-configured path
Settings          ~/.dico-app/dico-app.json        /data/users/{userId}/prefs.json
AI conversations  ~/.dico-app/storage/             /data/users/{userId}/conversations/
AI config         ~/.dico-app/ (user-managed)      Server env vars (admin-managed)
Git               Local git CLI                    Server-side git (team commits)
Frontend auth     Hidden (no login page)           Login page + user menu
```

## Desktop Mode (Profile: `local`)

### Overview

Desktop mode is designed for individual users running the app on their machine. No login is required — the user is automatically authenticated as admin with full access.

### How to Run

```bash
# Via npx (zero install)
npx @hamak/smart-data-dico --data-dir ./my-data-dictionary

# Via global install
npm install -g @hamak/smart-data-dico
smart-data-dico --data-dir ./my-project

# Via source
node bin/cli.js --data-dir ./data-dictionaries
```

### Characteristics

- **No authentication**: Auth middleware is bypassed, user auto-injected as `{ role: 'admin' }`
- **No login page**: Frontend skips login screen, hides user auth UI
- **Local storage**: All preferences, AI config, and conversations stored in `~/.dico-app/`
- **Local git**: Data directory can be a git repo for version control
- **Single process**: Backend + frontend served from one Node.js process
- **Auto-open browser**: Opens `http://localhost:{port}` on startup

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `DATA_DIR` | `./data-dictionaries` | Data directory path |
| `PROFILE` | `local` | Must be `local` for desktop mode |
| `ANTHROPIC_API_KEY` | - | AI provider key (optional, or configure in Settings) |

### File Structure

```
~/.dico-app/                           # App-level config (per machine)
├── dico-app.json                      # AI settings, preferences
└── storage/
    └── conversations/                 # AI chat history
        ├── {uuid}.json
        └── ...

./my-data-dictionary/                  # Data directory (per project)
├── microservices/
│   ├── billing/
│   │   ├── metadata.yaml
│   │   ├── relationships.yaml
│   │   └── {uuid}_{EntityName}.yaml
│   └── ...
├── perspectives/
│   └── {uuid}.yaml
├── diagrams/
│   └── {id}.json
└── stereotypes.yaml
```

## Server Mode (Profile: `team` or `server`)

### Overview

Server mode is designed for teams sharing a data dictionary over a network. Authentication is required, and user preferences are stored server-side.

### Profiles

| Profile | Auth | Git | Use Case |
|---------|------|-----|----------|
| `team` | JWT (local accounts) | Auto-commit per user | Small teams, shared server |
| `server` | JWT + Auth0/OIDC | Central git with PR workflow | Enterprise, production |

### How to Run

```bash
# Docker
docker run -p 3001:3001 \
  -e PROFILE=team \
  -e JWT_SECRET=your-secret \
  -e DATA_DIR=/data/dictionaries \
  -v ./data:/data \
  hamak/smart-data-dico

# Docker Compose (recommended)
docker-compose up -d
```

### Characteristics

- **Login required**: Users must authenticate via login page
- **Role-based access**: Admin (full), Editor (create/update), Viewer (read-only)
- **Server-side storage**: Preferences and AI conversations stored per-user on server
- **Shared data**: All users see the same data directory
- **Centralized AI config**: AI provider/keys managed by admin via env vars
- **Git integration**: Team profile auto-commits; server profile supports PR workflows

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `DATA_DIR` | `/data/dictionaries` | Shared data directory |
| `PROFILE` | - | `team` or `server` |
| `JWT_SECRET` | - | **Required**: Secret for JWT signing |
| `JWT_EXPIRES_IN` | `24h` | Token expiration |
| `AUTH0_DOMAIN` | - | Auth0 domain (server profile only) |
| `AUTH0_CLIENT_ID` | - | Auth0 client ID (server profile only) |
| `ANTHROPIC_API_KEY` | - | AI provider key (shared for all users) |
| `AI_PROVIDER` | `anthropic` | AI provider type |
| `AI_MODEL` | `claude-sonnet-4-5-20250514` | AI model |
| `GIT_AUTO_COMMIT` | `true` | Auto-commit on entity changes |

### User Storage Structure (Server Mode)

```
/data/
├── dictionaries/                      # Shared data (all users)
│   ├── microservices/
│   ├── perspectives/
│   ├── diagrams/
│   └── stereotypes.yaml
└── users/                             # Per-user storage
    ├── {userId}/
    │   ├── prefs.json                 # User preferences
    │   └── conversations/             # AI chat history
    │       └── {uuid}.json
    └── ...
```

## Architecture Diagram

```
Desktop Mode:
┌─────────────────────────────────┐
│ Browser (localhost:3001)        │
├─────────────────────────────────┤
│ Express Server (bundled)        │
│  ├─ API routes (no auth)        │
│  ├─ AI chat (user-configured)   │
│  ├─ Static frontend (SPA)       │
│  └─ Filesystem + Git            │
├─────────────────────────────────┤
│ Local filesystem                │
│  ├─ ./data-dictionaries/        │
│  └─ ~/.dico-app/                │
└─────────────────────────────────┘

Server Mode:
┌─────────────────────┐     ┌─────────────────────────────────┐
│ Browser (remote)    │────▶│ Express Server                  │
│  Login required     │     │  ├─ API routes (JWT auth)        │
└─────────────────────┘     │  ├─ AI chat (admin-configured)   │
                            │  ├─ Static frontend (SPA)        │
                            │  └─ Filesystem + Git             │
                            ├─────────────────────────────────┤
                            │ Server filesystem / volume       │
                            │  ├─ /data/dictionaries/          │
                            │  └─ /data/users/                 │
                            └─────────────────────────────────┘
```

## Implementation Phases

### Phase 1 — Clean Desktop Mode
- Remove login redirect in local profile
- Auto-authenticate as admin (bypass auth entirely)
- Hide login/register UI elements
- Status endpoint returns `{ mode: 'desktop' | 'server' }`
- Frontend detects mode and adapts UI

### Phase 2 — Server Mode Foundation
- Docker deployment with proper auth
- User-scoped storage service (prefs + conversations)
- Admin-managed AI config (env vars, not per-user)
- Role-based tool access in AI chat

### Phase 3 — Multi-User Features
- Concurrent editing awareness (who's editing what)
- User activity tracking
- Event channel for real-time updates (uses @hamak/event-channel)
- Role-based AI tool approval settings
