/**
 * IntegrationSampleProject.test.ts — #168 slice-3 leak detector
 *
 * Bootstraps the in-memory backend from the real eshop sample (read-only,
 * no fs.write/unlink/rm/mkdir/appendFile/copyFile) and exercises the four
 * slice-2/2b-migrated services through the contract.
 *
 * Assertions (§4.2):
 * 1. Capabilities differ from git (versionControl: false, object identity matches IN_MEMORY_CAPABILITIES)
 * 2. stereotypeService reads through memory backend (explicit constructor injection)
 * 3. diagramService lists 3 real diagrams from .dico/diagrams/
 * 4. promptService over empty 'app' workspace returns []
 * 5. conversationService over empty 'app' workspace returns []
 * 6. Module-singleton stereotypeService also resolves through the registry-backed memory backend
 * 7. subscribe() fires on write
 *
 * Assertion #6 is the key leak detector: it proves the production path
 * (controllers → module singletons → storageRegistry.getBackend()) works
 * against the memory backend, not just the constructor-injection test path.
 *
 * Path is computed from __dirname, NOT config.dataDir, so this test is
 * independent of env-var bleed.
 */
import * as path from 'path';
import * as fs from 'fs';
import { storageRegistry } from '../../contract/StorageBackendToken.js';
import { InMemoryStorageBackend } from '../InMemoryStorageBackend.js';
import { wsId, pathOf } from '../../contract/types.js';
import { StereotypeService } from '../../../services/stereotypeService.js';
import { stereotypeService as stereotypeServiceSingleton } from '../../../services/stereotypeService.js';
import { DiagramService } from '../../../services/diagramService.js';
import { PromptService } from '../../../services/promptService.js';
import { ConversationService } from '../../../services/conversationService.js';
import { IN_MEMORY_CAPABILITIES } from '../../contract/BackendCapabilities.js';

// Suppress logger noise during integration test
jest.mock('../../../utils/logger');

describe('Integration: memory backend over real eshop sample', () => {
  let backend: InMemoryStorageBackend;
  // __dirname is backend/src/storage/memory/__tests__ — 5 levels up reaches repo root
  const ESHOP = path.resolve(__dirname, '../../../../../samples/eshop');

  beforeAll(() => {
    // Read-only walk of the real sample → in-memory copies.
    // Direct map insertion (not write()) so no change events fire at seed time.
    backend = new InMemoryStorageBackend();
    const dictWs = wsId('dictionaries');
    const walk = (dir: string, rel: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        const relPath = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          walk(abs, relPath);
        } else if (ent.isFile()) {
          const wsKey = String(dictWs);
          const bucket = backend.files.get(wsKey);
          if (bucket) {
            bucket.set(relPath, fs.readFileSync(abs, 'utf8'));
          } else {
            backend.files.set(wsKey, new Map([[relPath, fs.readFileSync(abs, 'utf8')]]));
          }
        }
      }
    };
    walk(ESHOP, '');
    storageRegistry.setBackend(backend);
  });

  afterAll(() => {
    storageRegistry.reset();
  });

  // ── Assertion #1: Capabilities differ from git ──────────────────────────
  it('capabilities: versionControl is false (differs from git)', () => {
    expect(storageRegistry.getBackend().capabilities().versionControl).toBe(false);
  });

  it('capabilities: object identity matches IN_MEMORY_CAPABILITIES', () => {
    expect(storageRegistry.getBackend().capabilities()).toBe(IN_MEMORY_CAPABILITIES);
  });

  // ── Assertion #2: stereotypeService reads through memory backend ─────────
  it('StereotypeService (constructor injection) reads stereotypes from eshop', async () => {
    const svc = new StereotypeService(backend);
    const all = await svc.getAllStereotypes();
    expect(all.length).toBeGreaterThan(0);
  });

  // ── Assertion #3: diagramService lists real diagrams ────────────────────
  it('DiagramService lists 3 diagram layouts from .dico/diagrams/', async () => {
    const svc = new DiagramService(backend);
    const layouts = await svc.listDiagramLayouts();
    expect(layouts.length).toBe(3);
  });

  // ── Assertion #4: promptService over empty 'app' workspace ──────────────
  it('PromptService over empty app workspace returns []', async () => {
    const svc = new PromptService(backend);
    expect(await svc.list()).toEqual([]);
  });

  // ── Assertion #5: conversationService over empty 'app' workspace ─────────
  it('ConversationService over empty app workspace returns []', async () => {
    const svc = new ConversationService(backend);
    expect(await svc.list()).toEqual([]);
  });

  // ── Assertion #6: module-singleton path resolves through registry ─────────
  it('module-singleton stereotypeService resolves same count through registry', async () => {
    // The singleton uses storageRegistry.getBackend() lazily — set in beforeAll above.
    // This proves the production path (controllers → singletons → registry → backend)
    // works against memory, not just the constructor-injection test path.
    const svc = new StereotypeService(backend);
    const fromConstructor = await svc.getAllStereotypes();
    const fromSingleton = await stereotypeServiceSingleton.getAllStereotypes();
    expect(fromSingleton.length).toEqual(fromConstructor.length);
  });

  // ── Assertion #7: subscribe() fires on write ─────────────────────────────
  it('subscribe() fires a change event when write() is called', async () => {
    const events: import('../../contract/types.js').ChangeEvent[] = [];
    const ws = wsId('dictionaries');
    const observable = backend.subscribe(ws, pathOf(''));
    const subscription = observable.subscribe(e => events.push(e));

    const testPath = pathOf('test-subscribe-probe.txt');
    await backend.write(ws, testPath, 'hello');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].kind).toBe('created');
    expect(events[0].workspace).toBe(ws);

    subscription.unsubscribe();

    // Write after unsubscribe should NOT add to events
    const countBefore = events.length;
    await backend.write(ws, testPath, 'world');
    expect(events.length).toBe(countBefore);
  });
});
