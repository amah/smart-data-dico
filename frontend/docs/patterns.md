# Frontend patterns

The canonical patterns for smart-data-dico's frontend. Every plugin, page, component, service, command, and event follows them. New code is reviewed against this document.

> **Status**: OUTLINE — five worked examples are TODO. Fill them in once #166 lands its first proof (likely the stereotypes slice). Each TODO is a real example pulled from the actually-implemented code, not invented.

---

## 1. Smart vs. dumb components

Two component kinds, mutually exclusive.

| | Smart | Dumb |
|---|---|---|
| Receives | `path: Pathway` (sometimes `paths: Pathway[]`) | resolved data + change handlers |
| Knows about | Store FS, services, commands | the data shape it renders |
| Calls | `useFile(path)`, `useDirectory(path)`, `commands.execute(...)` | nothing — pure rendering |
| State | Path, possibly small ephemeral UI state (open/closed, hover) | none beyond what props give |
| Tests | Mount with a fixture Store FS; assert against rendered content | Render with props; assert against output |

Rule of thumb: if the component would need to know "did this load yet?" it's smart and gets a `path`. If it just renders given data, it's dumb and gets the data.

### TODO — Worked example #1: `EntityDetailPanel` (smart) and `EntityHeader` (dumb)

> Fill in once #166 stereotype slice lands. Pull the actual component code. Show:
> - The smart wrapper reading `useFile<Entity>(path)` and `node.state.contentLoading`
> - Dispatching `commands.execute('data-dictionary.entity.save', { path, content })`
> - The dumb child taking `{ name, description, dirty }` props
> - The boundary between them — no `path` crosses into the dumb component

---

## 2. Loading, error, dirty — never `useState`

These three flags live on the Store FS node, keyed by path:

```ts
const file = useFile<Entity>(path);

const loading = file?.state.contentLoading ?? false;
const error   = file?.state.contentLoadError;
const dirty   = file?.state.memo?.modified ?? false;
```

**Never write `const [loading, setLoading] = useState(false)` in a smart component.** ESLint blocks it. The same `path` in any other component sees the same flags — drift is impossible.

Ephemeral UI state (`isExpanded`, `hoveredRow`) does still use `useState`. The rule is: state about *a file's IO* lives on Store FS; state about *a component's local UI* lives in `useState`.

### TODO — Worked example #2: a list page that shows per-row loading

> Fill in. Use `PackageDetailPage` listing entities. Each row is a smart `EntityCard path={p}` — its own loading state, independent of siblings.

---

## 3. Services via DI

Components never import `@/services/api`. They resolve services from the kernel:

```ts
const dictionary = useService(DICTIONARY_SERVICE_TOKEN);
const entity = dictionary.useEntity(path);
```

Services come in two patterns:

- **Pattern A — Store FS facade**: methods take `path: Pathway`, return data via selectors. `useEntity`, `useDirectory`, `saveAt`, `deleteAt`. Most service methods are Pattern A.
- **Pattern B — REST wrapper**: methods wrap computed REST endpoints (search, integrity, lineage, AI chat). Take query parameters, return promises.

Mixing patterns within one service is fine when the surface genuinely splits — `AIService` has Pattern A for prompts/conversations (files) and Pattern B for chat (streaming).

### TODO — Worked example #3: `DictionaryService` skeleton

> Fill in. Show the constructor taking `storeFs`, `dispatch`, `getState`. Show one Pattern A method (`useEntity(path)`) and one Pattern B method (`searchEntities(query)`). Plugin registration via `ctx.provide`.

---

## 4. Commands and events

User-facing actions go through `commands.execute(...)`. Components don't call services directly for mutations.

```tsx
<DeleteButton onClick={() => commands.execute('data-dictionary.entity.delete', { path })} />
```

Naming: `<plugin>.<noun>.<verb>` (`data-dictionary.entity.create`, `git.commit`, `ai.chat.send`). Path is the binding for file-shaped commands.

Events carry both `path` and `uuid` for file-shaped objects, so listeners can re-resolve after a move:

```ts
hooks.emit('entity.deleted', { path, uuid });
hooks.emit('entity.moved',   { fromPath, toPath, uuid });
```

Cross-plugin reactions subscribe by event name. Don't call across plugins via direct imports.

### TODO — Worked example #4: a command + its listener

> Fill in. `data-dictionary.entity.delete` registration in `dataDictionaryPlugin.ts`. Search plugin listens to `entity.deleted` and re-indexes. Show the full path through the bus.

---

## 5. Paths and identity

- **Path is the address** the frontend uses to fetch, cache, and route.
- **UUID is the identity** for cross-references in content. Relationships point at `entity.uuid`; rules reference `attribute.uuid`. UUIDs never change on rename or move.
- **Logical path** is what domain code sees (`packages/eshop/orders/entities/Order`). **Raw path** is what the git plugin and file-browser see (the actual YAML file path). They're two workspaces in Store FS; backend's projection layer keeps them coherent.
- **Stale paths** (bookmarks, AI conversation history) resolve via `dictionary.findPathByUuid(uuid)` and redirect.

Never construct paths by string concatenation. Use `Pathway` from `@hamak/shared-utils`. Never assume a path's physical layout — go through the service.

### TODO — Worked example #5: rename flow

> Fill in. Show:
> - `commands.execute('data-dictionary.entity.move', { fromPath, toPath })`
> - Backend projection rewrites paths atomically
> - `entity.moved` event fires with `{ fromPath, toPath, uuid }`
> - Route guard hears the event and redirects the open editor
> - AI conversation history captures `uuid` so subsequent messages resolve to the new path

---

## Anti-patterns

These are explicit nos. Reviewers reject PRs that contain them.

- ❌ `import { entityApi } from '@/services/api'` outside `plugins/*/services/*.ts`
- ❌ `import axios from 'axios'` outside `plugins/*/services/*.ts`
- ❌ `useState<boolean>(false)` named `loading` / `isLoading` / `loaded` in a smart component
- ❌ `useState<Error | null>(null)` for a fetch error in a smart component
- ❌ Component-local state mirroring a Store FS node (`useState<Entity>(null) + useEffect(fetchEntity)`)
- ❌ Passing `entity: Entity` as a prop into a smart component that could take `path` instead
- ❌ `string + '/' + name` for path construction — use `Pathway.resolve`
- ❌ Direct cross-plugin imports (`import { caseSlice } from '@/plugins/case/slices/casesSlice'` from a non-`data-dictionary` plugin)
- ❌ Workspace IDs hardcoded as `'dictionaries'` — they come from `currentUser.id` (multi-user) or are derived from the storage backend's capabilities
- ❌ DaisyUI class names or hex colors on new code — use `ui/` primitives + tokens (per the design-system memory rule)

---

## Where the boundaries are

The frontend is responsible for: rendering, dispatching commands, reading Store FS, presenting feedback. Nothing else.

The frontend is **not** responsible for:

- Multi-kind YAML merge semantics (backend projection layer, #167)
- UUID → path resolution (backend, exposed via `findPathByUuid`)
- Storage transport (Store FS sync middleware, plugin-shaped)
- Domain validation (backend, runs at write time)
- Git operations (framework git plugin → backend)
- AI agent loop (backend `aiController`)

If a component starts feeling like it needs to know any of this, it's reaching beyond its layer. Push the responsibility down to a service or a backend endpoint.

---

## Living document

This file is rewritten as patterns emerge. Each TODO above gets filled in by a human looking at *real merged code* — never by an agent inventing what the pattern should look like. When a pattern stabilizes and is repeated in three or more places in the codebase, document it here. When a pattern is documented but the code drifts, fix the code (not the doc) to match.
