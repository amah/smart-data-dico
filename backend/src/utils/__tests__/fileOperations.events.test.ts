/**
 * fileOperations.events.test.ts — #201 Phase 2 (first-class Events)
 *
 * Tests `parseSectionsFromString` recognition of `events:`, `mergePackageSections`
 * collision detection (uuid + name), and `writeEvent` / `deleteEvent` persistence.
 * Uses InMemoryStorageBackend; no real filesystem touched. Mirrors
 * fileOperations.actions.test.ts.
 */

import YAML from 'yaml';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { storageRegistry } from '../../storage/contract/StorageBackendToken.js';
import { wsId } from '../../storage/contract/types.js';
import {
  parseSectionsFromString,
  mergePackageSections,
  writeEvent,
  deleteEvent,
} from '../fileOperations.js';
import type { ParsedSections } from '../fileOperations.js';
import type { Event } from '../../models/Event.js';

const OWNER_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  uuid: 'evt-test-001',
  name: 'order.cancelled',
  ownerRef: OWNER_UUID,
  ...overrides,
});

const emptySections = () => ({
  entities: [], relationships: [], rules: [], cases: [], actions: [], stateMachines: [], events: [],
});

// ── parseSectionsFromString ───────────────────────────────────────────────────

describe('parseSectionsFromString — events (#201)', () => {
  it('parses a YAML string with an events: section', () => {
    const raw = YAML.stringify({ events: [makeEvent()] });
    const parsed = parseSectionsFromString(raw, 'test.events.yaml');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].uuid).toBe('evt-test-001');
  });

  it('defaults events to [] for files without an events: section', () => {
    const raw = YAML.stringify({ entities: [{ uuid: 'e1', name: 'Order', attributes: [] }] });
    expect(parseSectionsFromString(raw, 'Order.model.yaml').events).toEqual([]);
  });
});

// ── mergePackageSections collision detection ──────────────────────────────────

describe('mergePackageSections — event collision detection (#201)', () => {
  it('throws on duplicate event UUID across files (both paths in message)', () => {
    const file1: ParsedSections = {
      label: 'order-service/A.events.yaml',
      sections: { ...emptySections(), events: [makeEvent({ uuid: 'evt-dup' })] },
    };
    const file2: ParsedSections = {
      label: 'order-service/B.events.yaml',
      sections: { ...emptySections(), events: [makeEvent({ uuid: 'evt-dup', name: 'other.name' })] },
    };
    expect(() => mergePackageSections('order-service', [file1, file2])).toThrow(
      /Duplicate event uuid 'evt-dup'.*A\.events\.yaml.*B\.events\.yaml/,
    );
  });

  it('throws on duplicate event name within a package', () => {
    const file1: ParsedSections = {
      label: 'order-service/A.events.yaml',
      sections: { ...emptySections(), events: [makeEvent({ uuid: 'evt-a', name: 'order.paid' })] },
    };
    const file2: ParsedSections = {
      label: 'order-service/B.events.yaml',
      sections: { ...emptySections(), events: [makeEvent({ uuid: 'evt-b', name: 'order.paid' })] },
    };
    expect(() => mergePackageSections('order-service', [file1, file2])).toThrow(
      /Duplicate event name 'order.paid'/,
    );
  });

  it('merges events from multiple files and tracks ownership', () => {
    const file1: ParsedSections = {
      label: 'order-service/Order.model.yaml',
      sections: { ...emptySections(), events: [makeEvent({ uuid: 'evt-1', name: 'order.created' })] },
    };
    const file2: ParsedSections = {
      label: 'order-service/More.events.yaml',
      sections: { ...emptySections(), events: [makeEvent({ uuid: 'evt-2', name: 'order.shipped' })] },
    };
    const model = mergePackageSections('order-service', [file1, file2]);
    expect(model.events).toHaveLength(2);
    expect(model.ownership.eventByUuid.get('evt-1')).toBe('order-service/Order.model.yaml');
    expect(model.ownership.eventByName.get('order.shipped')).toBe('order-service/More.events.yaml');
  });

  it('skips events missing uuid or name without throwing', () => {
    const file1: ParsedSections = {
      label: 'order-service/junk.yaml',
      sections: {
        ...emptySections(),
        events: [
          { uuid: '', name: 'no-uuid' } as Event,
          { uuid: 'evt-ok', name: 'ok' },
        ],
      },
    };
    const model = mergePackageSections('order-service', [file1]);
    expect(model.events).toHaveLength(1);
    expect(model.events[0].uuid).toBe('evt-ok');
  });
});

// ── writeEvent / deleteEvent persistence ──────────────────────────────────────

describe('writeEvent and deleteEvent — in-memory persistence (#201)', () => {
  let backend: InMemoryStorageBackend;
  const WS = wsId('dictionaries');

  beforeEach(() => {
    storageRegistry.reset();
    backend = new InMemoryStorageBackend();
    storageRegistry.setBackend(backend);
    const ws = String(WS);
    if (!backend.files.has(ws)) backend.files.set(ws, new Map());
    const rootDirs = backend.dirs.get(ws) ?? new Set<string>();
    rootDirs.add('');
    backend.dirs.set(ws, rootDirs);
  });

  it('writeEvent merges into the owner entity model file when it exists', async () => {
    const entity = { uuid: OWNER_UUID, name: 'Order', status: 'draft', attributes: [] };
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.model.yaml', YAML.stringify({ entities: [entity] })],
    ]));

    const result = await writeEvent(makeEvent({ uuid: 'evt-merge', name: 'order.cancelled' }), 'order-service');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.model.yaml' as never);
    const parsed = YAML.parse(after);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].uuid).toBe('evt-merge');
  });

  it('writeEvent creates a dedicated .events.yaml when the owner has no model file', async () => {
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
    ]));

    const result = await writeEvent(makeEvent({ uuid: 'evt-new', name: 'order.refunded', ownerRef: undefined }), 'order-service');
    expect(result.ok).toBe(true);

    const ws = backend.files.get('dictionaries')!;
    let found = false;
    for (const [, content] of ws.entries()) {
      const parsed = YAML.parse(content);
      if (parsed?.events?.some((e: Event) => e.uuid === 'evt-new')) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it('deleteEvent removes the event from its file', async () => {
    const initial = YAML.stringify({
      events: [makeEvent({ uuid: 'evt-del-1', name: 'a' }), makeEvent({ uuid: 'evt-del-2', name: 'b' })],
    });
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.events.yaml', initial],
    ]));

    const result = await deleteEvent('evt-del-1');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.events.yaml' as never);
    const parsed = YAML.parse(after);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].uuid).toBe('evt-del-2');
  });
});
