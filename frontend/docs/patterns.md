# Frontend patterns

The canonical patterns for smart-data-dico's frontend. Every plugin, page, component, service, command, and event follows them. New code is reviewed against this document.

> **Status**: §2 and §3 filled (May 2026, post #166 stereotype-slice and #155-integrity pilots — PRs #172 and #173). §1, §4, §5 are still TODO and await tickets that exercise those patterns directly. Each filled example is real code pulled from merged source, not invented.

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

### Worked example #2 — `StereotypesPage` (Pattern A consumer)

From `frontend/src/pages/StereotypesPage.tsx` (merged in #166's stereotype-slice proof, PR #172):

```tsx
export default function StereotypesPage() {
  const service = useService<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);

  // EPHEMERAL UI state only — modal open / row being edited. §1.5
  // explicitly carves these out.
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // FILE IO state — loading / loaded / error — comes from the Store FS
  // node, NOT from useState.
  const file = service.useFile();
  const stereotypes: Stereotype[] = file?.content ?? [];

  // Canonical loading derivation (cookbook-equivalent of
  // `file?.state.contentLoading ?? false`, with the no-node-yet case
  // handled explicitly):
  const loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError);
  const error   = file?.state.contentLoadError;

  // … render <Toolbar /> + grouped stereotype lists + <Modal /> for editing
}
```

Two things to notice:

1. **`useState` only appears for ephemeral UI** (`showCreate`, `editingId`). Both have the `boolean | string-id` shape that the §1.5 carve-out explicitly permits — they are about *this component's* open/closed state, not about whether a file has loaded.
2. **`loading` is derived, not stored.** The same path opened twice (e.g., the user navigates away and back) shares the Store FS node, which means `contentLoaded` is already `true` the second time and the page paints synchronously without re-fetching. The framework's store-sync middleware owns the lifecycle; the page just selects.

The `loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError)` form is the "no-node-yet" handler — `file` is `undefined` on first render until the selector returns a value. Once any code dispatches `setFile(...)` for that path, the node exists and `contentLoaded === true` (verified at `@hamak/shared-utils/dist/core-utils-filesystem.js`).

**Pattern B note.** When the service is a REST wrapper (no Store FS node to read state from), the page falls back to `useState<loading|error>` per the §1.5 ephemeral-UI exception — see `IntegrityPage.tsx` and the §3b worked example. The two patterns are not symmetric here; ban Pattern B `useState` only when a Store FS-backed alternative exists.

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

### Worked example #3a — Pattern A: `StereotypeService` (Store FS facade)

From `frontend/src/plugins/data-dictionary/services/StereotypeService.ts` (merged in #166's stereotype-slice proof, PR #172):

```ts
export class StereotypeService {
  constructor(
    private readonly storeFs: StoreFileSystemFacade<RootState>,
    private readonly dispatch: Dispatch<Action>,
    private readonly getState: () => RootState,
    private readonly notify: NotifyFn = () => {},
  ) {}

  /** Hook — returns the Store FS file node. Page reads loading/error
   *  from `node.state.contentLoaded` / `contentLoadError` per §2. */
  useFile(): FileNode<Stereotype[]> | undefined {
    const selector = this.storeFs.createFileSelector([...STEREOTYPES_PATH]);
    return useSelector(selector) as FileNode<Stereotype[]> | undefined;
  }

  useAll(): Stereotype[] | undefined { return this.useFile()?.content; }

  /** Mutation — dispatches Store FS edits; framework writes upstream. */
  async save(s: Stereotype): Promise<void> {
    // …read-modify-write of the multi-kind file; dispatch setFile(...)
  }
}
```

Registration in the plugin's `initialize` lifecycle, from `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`:

```ts
async initialize(ctx) {
  // Resolve cross-plugin dependencies via DI tokens.
  const storeFs   = ctx.resolve(STORE_FS_TOKEN);       // from store-fs plugin
  const storeMgr  = ctx.resolve(STORE_MANAGER_TOKEN);  // from store plugin

  const service = new StereotypeService(
    storeFs,
    storeMgr.getStore().dispatch,
    storeMgr.getStore().getState,
    (level, message) => notifyImpl(level, message),    // closure forwarder
  );

  ctx.provide({ provide: STEREOTYPE_SERVICE_TOKEN, useValue: service });
}
```

Consumer (a smart component) just resolves the token via the `useService` hook from `frontend/src/kernel/useService.ts` and addresses by path:

```tsx
// frontend/src/pages/StereotypesPage.tsx
export default function StereotypesPage() {
  const service = useService<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);
  const file = service.useFile();
  const stereotypes = file?.content ?? [];
  const loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError);
  const error = file?.state.contentLoadError;
  // … rendering
}
```

### Worked example #3b — Pattern B: `IntegrityService` (REST wrapper)

From `frontend/src/plugins/data-dictionary/services/IntegrityService.ts` (merged in #155-integrity, PR #173):

```ts
export class IntegrityService {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    // Optional injection lets unit tests pass a stub; production gets
    // a default instance with the auth interceptor baked in.
    this.http = http ?? IntegrityService.createDefaultHttp();
  }

  async getReport(): Promise<IntegrityReport> {
    const response = await this.http.get<{ data: IntegrityReport }>('/integrity');
    return response.data.data;
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({ baseURL: '/api', headers: { 'Content-Type': 'application/json' } });
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
```

Pattern B registers with an **eager `useValue`** — no store-activation dependency, no Proxy placeholder needed (in contrast to Pattern A which must defer facade construction to `activate`):

```ts
// dataDictionaryPlugin.ts (initialize)
ctx.provide({
  provide: INTEGRITY_SERVICE_TOKEN,
  useValue: new IntegrityService(),
});
```

Consumer is identical-shape to Pattern A — `useService(TOKEN)` then call the method:

```tsx
// frontend/src/pages/IntegrityPage.tsx
const service = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
useEffect(() => {
  service.getReport().then(setReport).catch(setError);
}, [service]);
```

### When to use which

- File-shaped data (one logical address per object, cached, reactive) → **Pattern A**.
- Computed / derived results (no file shape, server aggregates over many files) → **Pattern B**.
- A service may mix both — `AIService` is Pattern A for prompts/conversations on disk and Pattern B for chat streaming. Split methods cleanly within the same class.

### Anti-patterns specific to services

- ❌ Importing from `@/services/api` inside `plugins/*/services/*.ts` (the service should own its own axios for Pattern B, or dispatch Redux for Pattern A).
- ❌ Storing fetched data in `useState` inside the page — Pattern B's loading/error live in the page (§1.5 ephemeral-UI carve-out applies *only* because there is no Store FS node to attach them to), but the **data itself** is the service's return value, not page state.
- ❌ Holding a reference to the service in `useState` or `useRef`. `useService(TOKEN)` returns the same singleton every render (DI cache).

### Pattern B variant — registry-shaped tokens

Some Pattern B tokens hold a **mutable registry** rather than a REST wrapper. `METADATA_TYPE_REGISTRY_TOKEN` is the in-house example: it holds a `MetadataTypeRegistry` instance that the `data-dictionary` plugin seeds with 9 built-in contributions during `initialize`. Other plugins can extend it by resolving and calling `register`:

```ts
// In another plugin's initialize:
const registry = ctx.resolve<MetadataTypeRegistry>(METADATA_TYPE_REGISTRY_TOKEN);
registry.register(myEmailContribution);
```

The token is still provided as an eager `useValue` (same shape as `INTEGRITY_SERVICE_TOKEN`):

```ts
// dataDictionaryPlugin.ts (initialize)
const metadataRegistry = createMetadataTypeRegistry({ unknownTypeFallback: UnknownTypeContribution });
registerBuiltinContributions(metadataRegistry);
ctx.provide({ provide: METADATA_TYPE_REGISTRY_TOKEN, useValue: metadataRegistry });
```

Precedent: `STORE_EXTENSIONS_TOKEN` from `@hamak/ui-store-api` (`frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:8`) is the closest in-framework analog — `@hamak/ui-remote-fs` and `@hamak/notification` write into it as a registry extension point. `METADATA_TYPE_REGISTRY_TOKEN` follows the same shape, applied to the metadata-type domain.

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
