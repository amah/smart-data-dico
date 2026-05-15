// frontend/src/plugins/data-dictionary/services/StereotypeService.ts
//
// Pattern A facade per #155 catalog. Store FS-backed reads, REST-shim
// writes during this pilot (see Risk 1 for the JSON-vs-YAML rationale).
//
// All public methods take or return logical-shape data. The stereotypes
// path (`['dictionaries', '.dico', 'stereotypes.yaml']`) is hidden inside
// this service; callers never see it.
//
// Loading/error/dirty state lives on the Store FS node per patterns.md §2.
// The page consumes `service.useFile()` and derives loading from
// `node?.state.contentLoaded` and `node?.state.contentLoadError` using the
// cookbook-canonical form: `loading = !file || (!file.state.contentLoaded
// && !file.state.contentLoadError)`. `contentLoading` (the in-flight
// GET_REQUEST flag) is deliberately NOT consulted — the framework's
// store-sync middleware is the only thing that mutates it, and this pilot
// bypasses that middleware (Risk 1 / Bug B). No `useState<boolean>(loading
// |loaded)` and no `useState<Error>` in any new file.

import type { Action, Dispatch } from 'redux';
import { useSelector } from 'react-redux';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import type { FileNode } from '@hamak/shared-utils';
import { stereotypeApi } from '../../../services/api';
import type { Stereotype, StereotypeTarget } from '../../../types';
import type { RootState } from '../../../kernel/bootstrap';

/**
 * Filesystem path under the 'dictionaries' workspace mount point.
 * Will become a LOGICAL path once #167 lands backend projection.
 */
export const STEREOTYPES_PATH: readonly string[] = Object.freeze([
  'dictionaries',
  '.dico',
  'stereotypes.yaml',
]);

/**
 * Optional callback used to surface load errors as toasts via the
 * notification plugin. Wired in dataDictionaryPlugin.initialize. Keeping it
 * a callback (rather than a hard dep on the notification token) lets unit
 * tests bootstrap the service without the notification plugin.
 */
export type NotifyFn = (level: 'error' | 'warning' | 'info', message: string) => void;

export class StereotypeService {
  constructor(
    private readonly storeFs: StoreFileSystemFacade<RootState>,
    // Dispatch parameterized with the basic `Action` (not the default
    // `UnknownAction`) because the framework's `FileSystemNodeAction`
    // extends only `Action` and does not satisfy `UnknownAction`'s
    // index signature.
    private readonly dispatch: Dispatch<Action>,
    private readonly getState: () => RootState,
    private readonly notify: NotifyFn = () => {},
  ) {}

  /**
   * Hook — returns the Store FS file node for `stereotypes.yaml`.
   * The page reads `node?.state.contentLoading`, `node?.state.contentLoaded`,
   * `node?.state.contentLoadError` from it — fulfilling patterns.md §2.
   *
   * Selector is created per-render. See Risk 4 for the memoization
   * tradeoff (single-array selector, O(path-depth=3) traversal per
   * dispatched action — acceptable for the pilot).
   */
  useFile(): FileNode<Stereotype[]> | undefined {
    const selector = this.storeFs.createFileSelector([...STEREOTYPES_PATH]);
    return useSelector(selector) as FileNode<Stereotype[]> | undefined;
  }

  /** Convenience — array of stereotypes (or `undefined` until loaded). */
  useAll(): Stereotype[] | undefined {
    return this.useFile()?.content;
  }

  /** Hook — filtered view. */
  useByTarget(target: StereotypeTarget): Stereotype[] | undefined {
    const all = this.useAll();
    return all?.filter((s) => s.appliesTo === target);
  }

  /**
   * Imperative — load (or reload) all stereotypes via the REST shim and
   * populate Store FS. On failure, marks the cache node with
   * `contentIsPresent: false` (so `contentLoaded` becomes `false`) AND
   * fires `notify('error', …)` so the page can render a toast without
   * touching `useState`.
   *
   * Idempotent: calling twice in quick succession re-fetches both times.
   * The pilot does not debounce; #167 will (via the framework's GET flow).
   */
  async loadAll(): Promise<Stereotype[]> {
    try {
      const list = await stereotypeApi.getAll();
      this.hydrate(list, true);
      return list;
    } catch (err) {
      // Mark node as "load attempted, content not present" so the page's
      // contentLoaded check shows "loaded but empty" rather than spinning.
      this.hydrate([], false);
      const message = extractMessage(err) ?? 'Failed to load stereotypes';
      this.notify('error', message);
      throw err;
    }
  }

  /** Imperative read of the cache without subscribing. */
  getAll(): Stereotype[] | undefined {
    const file = this.storeFs.selectFileFromRoot(
      this.getState(),
      [...STEREOTYPES_PATH],
    ) as FileNode<Stereotype[]> | undefined;
    return file?.content;
  }

  async create(data: Stereotype): Promise<Stereotype> {
    const res = await stereotypeApi.create(data);
    // Backend returns `{ success, stereotype }` per backend
    // stereotypeService.ts:55. `stereotypeApi.create` returns
    // `response.data` (api.ts:567), which is that envelope. Unwrap.
    const created: Stereotype =
      (res as { stereotype?: Stereotype }).stereotype
      ?? (res as { data?: Stereotype }).data
      ?? data;
    const current = this.getAll() ?? [];
    this.hydrate([...current, created], true);
    return created;
  }

  async update(id: string, data: Partial<Stereotype>): Promise<Stereotype> {
    const res = await stereotypeApi.update(id, data);
    const existing = this.getAll()?.find((s) => s.id === id) ?? ({} as Stereotype);
    const updated: Stereotype =
      (res as { stereotype?: Stereotype }).stereotype
      ?? (res as { data?: Stereotype }).data
      ?? ({ ...existing, ...data } as Stereotype);
    const current = this.getAll() ?? [];
    this.hydrate(
      current.map((s) => (s.id === id ? updated : s)),
      true,
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    await stereotypeApi.delete(id);
    const current = this.getAll() ?? [];
    this.hydrate(current.filter((s) => s.id !== id), true);
  }

  /**
   * Write the canonical list into Store FS via `setFile`.
   *
   * Why `setFile` and not `setFileContent`:
   *   `setFileContent` triggers the autosave middleware (#166 Phase 1
   *   wiring) which calls RemoteFsAutosaveProvider.save → dispatches
   *   PUT_REQUEST → http-workspace-client.putFile → JSON.stringify on
   *   the array → backend writes JSON into stereotypes.yaml — wrong.
   *   `setFile` does NOT trigger autosave (autosave-middleware.js:15-18
   *   only watches 'set-file-content' and 'update-file-content'). For
   *   this pilot, writes flow through the REST shim only; Store FS is
   *   cache-only. See Risk 1.
   *
   * `contentIsPresent` controls `state.contentLoaded` on the created node
   * (verified at fileSystemNodeInitialState in
   * frontend/node_modules/@hamak/shared-utils/dist/core-utils-filesystem.js:2-4
   * — `contentLoaded: contentPresent`). We pass `true` on success and
   * `false` on load failure, so the page can distinguish "never loaded",
   * "loaded successfully (possibly empty)", and "load failed".
   */
  private hydrate(list: Stereotype[], contentIsPresent: boolean): void {
    // `setFile` against a path whose parent directories do not exist is a
    // silent no-op (verified at frontend/node_modules/@hamak/ui-store-impl/
    // dist/fs/commands/fs-commands.js:127-149 — when `getFileSystemNode`
    // returns undefined for the parent path, executeSetFile `return`s
    // without warning). The framework's initial state is `root.children: {}`
    // so neither `dictionaries` nor `dictionaries/.dico` exists yet. We
    // therefore dispatch `mkdir` with `parents: true` first; the action
    // creator `FileSystemAdapter.mkdir(path, parents?, extensionStates?)`
    // is verified at @hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:53
    // and at fs-adapter.js:97-100 (positional args, NOT an options object).
    // The handler honours `parents=true` by creating every missing
    // intermediate directory (executeMkdir at fs-commands.js:69-104,
    // specifically the `parents === true` branch at lines 86-89). `mkdir`
    // on an already-existing directory is a no-op (line 79 `if undefined`
    // guard), so re-hydration is safe.
    const actions = this.storeFs.getActions();
    this.dispatch(
      actions.mkdir(['dictionaries', '.dico'], true),
    );
    this.dispatch(
      actions.setFile(
        [...STEREOTYPES_PATH],
        list,
        'application/yaml',
        { override: true, contentIsPresent },
      ),
    );
  }
}

function extractMessage(err: unknown): string | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as {
      response?: { data?: { errors?: string[]; message?: string } };
      message?: string;
    };
    return (
      e.response?.data?.errors?.[0]
      ?? e.response?.data?.message
      ?? e.message
      ?? null
    );
  }
  return null;
}
