/**
 * fileOperations.actions.test.ts — #179 Actions + State Machines
 *
 * Tests for the new `mergePackageSections` collision detection and
 * `parseSectionsFromString` recognition of `actions:` and `stateMachines:`
 * sections. Uses InMemoryStorageBackend; no real filesystem touched.
 *
 * Mirrors the pattern established in fileOperations.multiKind.test.ts.
 */

import YAML from 'yaml';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { storageRegistry } from '../../storage/contract/StorageBackendToken.js';
import { wsId } from '../../storage/contract/types.js';
import {
  parseSectionsFromString,
  mergePackageSections,
  writeAction,
  deleteAction,
  writeStateMachine,
  deleteStateMachine,
  writeEntityFile,
} from '../fileOperations.js';
import type { ParsedSections } from '../fileOperations.js';
import type { Action } from '../../models/Action.js';
import type { StateMachine } from '../../models/StateMachine.js';
import type { Entity } from '../../models/EntitySchema.js';
import { EntityStatus } from '../../models/EntitySchema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const makeAction = (overrides: Partial<Action> = {}): Action => ({
  uuid: 'act-test-001',
  name: 'cancel',
  ownerRef: OWNER_UUID,
  params: [],
  flow: [],
  ...overrides,
});

const makeStateMachine = (overrides: Partial<StateMachine> = {}): StateMachine => ({
  uuid: 'sm-test-001',
  name: 'fulfillment',
  ownerRef: OWNER_UUID,
  initialState: 'PENDING',
  states: [{ name: 'PENDING' }, { name: 'DONE', terminal: true }],
  transitions: [],
  ...overrides,
});

const makeEntity = (overrides: Partial<Entity> = {}): Entity => ({
  uuid: OWNER_UUID,
  name: 'Order',
  status: EntityStatus.DRAFT,
  attributes: [],
  ...overrides,
});

// ── parseSectionsFromString ───────────────────────────────────────────────────

describe('parseSectionsFromString — #179 sections', () => {
  it('parses a YAML string with only an actions: section', () => {
    const raw = YAML.stringify({ actions: [makeAction()] });
    const result = parseSectionsFromString(raw, 'Order.actions.yaml');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].uuid).toBe('act-test-001');
    expect(result.stateMachines).toHaveLength(0);
    expect(result.entities).toHaveLength(0);
  });

  it('parses a YAML string with only a stateMachines: section', () => {
    const raw = YAML.stringify({ stateMachines: [makeStateMachine()] });
    const result = parseSectionsFromString(raw, 'Order.statemachine.yaml');
    expect(result.stateMachines).toHaveLength(1);
    expect(result.stateMachines[0].uuid).toBe('sm-test-001');
    expect(result.actions).toHaveLength(0);
  });

  it('parses a multi-kind YAML file with entities, actions, and stateMachines', () => {
    const raw = YAML.stringify({
      entities: [makeEntity()],
      actions: [makeAction()],
      stateMachines: [makeStateMachine()],
    });
    const result = parseSectionsFromString(raw, 'Order.model.yaml');
    expect(result.entities).toHaveLength(1);
    expect(result.actions).toHaveLength(1);
    expect(result.stateMachines).toHaveLength(1);
  });

  it('returns empty arrays for actions/stateMachines when neither section is present', () => {
    const raw = YAML.stringify({ entities: [makeEntity()] });
    const result = parseSectionsFromString(raw, 'Order.model.yaml');
    expect(result.actions).toHaveLength(0);
    expect(result.stateMachines).toHaveLength(0);
  });

  it('returns empty arrays for all sections on empty / null YAML', () => {
    const result = parseSectionsFromString('', 'empty.yaml');
    expect(result.actions).toHaveLength(0);
    expect(result.stateMachines).toHaveLength(0);
  });
});

// ── mergePackageSections — collision detection ────────────────────────────────

describe('mergePackageSections — collision detection for actions and state machines', () => {
  it('throws on duplicate action UUID across two files (both paths in message)', () => {
    const file1: ParsedSections = {
      label: 'order-service/Order.model.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [makeAction({ uuid: 'act-dup-uuid' })],
        stateMachines: [],
      },
    };
    const file2: ParsedSections = {
      label: 'order-service/Order.actions.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [makeAction({ uuid: 'act-dup-uuid', name: 'cancelDuplicate' })],
        stateMachines: [],
      },
    };

    expect(() => mergePackageSections('order-service', [file1, file2])).toThrow(
      /Duplicate action uuid 'act-dup-uuid'.*order-service\/Order\.model\.yaml.*order-service\/Order\.actions\.yaml/,
    );
  });

  it('throws on duplicate stateMachine UUID across two files (both paths in message)', () => {
    const file1: ParsedSections = {
      label: 'order-service/Order.model.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [],
        stateMachines: [makeStateMachine({ uuid: 'sm-dup-uuid' })],
      },
    };
    const file2: ParsedSections = {
      label: 'order-service/Order.statemachine.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [],
        stateMachines: [makeStateMachine({ uuid: 'sm-dup-uuid', name: 'paymentDuplicate' })],
      },
    };

    expect(() => mergePackageSections('order-service', [file1, file2])).toThrow(
      /Duplicate stateMachine uuid 'sm-dup-uuid'.*order-service\/Order\.model\.yaml.*order-service\/Order\.statemachine\.yaml/,
    );
  });

  it('throws on duplicate (ownerRef, name) pair for two state machines on the same owner', () => {
    const file1: ParsedSections = {
      label: 'order-service/A.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [],
        stateMachines: [makeStateMachine({ uuid: 'sm-a', name: 'fulfillment', ownerRef: OWNER_UUID })],
      },
    };
    const file2: ParsedSections = {
      label: 'order-service/B.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [],
        stateMachines: [makeStateMachine({ uuid: 'sm-b', name: 'fulfillment', ownerRef: OWNER_UUID })],
      },
    };

    expect(() => mergePackageSections('order-service', [file1, file2])).toThrow(
      /Duplicate stateMachine name 'fulfillment' for ownerRef '96a3ac78/,
    );
  });

  it('throws on duplicate (ownerRef, name) pair for two actions on the same owner', () => {
    const file1: ParsedSections = {
      label: 'order-service/A.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [makeAction({ uuid: 'act-a', name: 'cancel', ownerRef: OWNER_UUID })],
        stateMachines: [],
      },
    };
    const file2: ParsedSections = {
      label: 'order-service/B.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [makeAction({ uuid: 'act-b', name: 'cancel', ownerRef: OWNER_UUID })],
        stateMachines: [],
      },
    };

    expect(() => mergePackageSections('order-service', [file1, file2])).toThrow(
      /Duplicate action name 'cancel' for ownerRef '96a3ac78/,
    );
  });

  it('does NOT throw when two state machines share a name but belong to different owners', () => {
    const OTHER_OWNER = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const file1: ParsedSections = {
      label: 'order-service/A.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [],
        stateMachines: [makeStateMachine({ uuid: 'sm-a', name: 'fulfillment', ownerRef: OWNER_UUID })],
      },
    };
    const file2: ParsedSections = {
      label: 'order-service/B.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [],
        stateMachines: [makeStateMachine({ uuid: 'sm-b', name: 'fulfillment', ownerRef: OTHER_OWNER })],
      },
    };

    expect(() => mergePackageSections('order-service', [file1, file2])).not.toThrow();
  });

  it('merges actions and stateMachines from multiple files when there are no collisions', () => {
    const file1: ParsedSections = {
      label: 'order-service/Order.actions.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [makeAction({ uuid: 'act-1', name: 'cancel' })],
        stateMachines: [],
      },
    };
    const file2: ParsedSections = {
      label: 'order-service/Order.statemachine.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [makeAction({ uuid: 'act-2', name: 'refund' })],
        stateMachines: [
          makeStateMachine({ uuid: 'sm-1', name: 'fulfillment' }),
          makeStateMachine({ uuid: 'sm-2', name: 'payment', ownerRef: OWNER_UUID }),
        ],
      },
    };

    const model = mergePackageSections('order-service', [file1, file2]);
    expect(model.actions).toHaveLength(2);
    expect(model.stateMachines).toHaveLength(2);
    expect(model.ownership.actionByUuid.has('act-1')).toBe(true);
    expect(model.ownership.actionByUuid.has('act-2')).toBe(true);
    expect(model.ownership.stateMachineByUuid.has('sm-1')).toBe(true);
    expect(model.ownership.stateMachineByUuid.has('sm-2')).toBe(true);
  });

  it('skips actions/stateMachines with missing uuid or ownerRef without throwing', () => {
    const file1: ParsedSections = {
      label: 'order-service/junk.yaml',
      sections: {
        entities: [],
        relationships: [],
        rules: [],
        cases: [],
        actions: [
          { uuid: '', name: 'no-uuid', ownerRef: OWNER_UUID } as unknown as Action,
          { uuid: 'act-ok', name: 'valid', ownerRef: OWNER_UUID },
        ],
        stateMachines: [
          { uuid: '', name: 'no-uuid-sm', ownerRef: OWNER_UUID } as unknown as StateMachine,
        ],
      },
    };

    const model = mergePackageSections('order-service', [file1]);
    expect(model.actions).toHaveLength(1);
    expect(model.actions[0].uuid).toBe('act-ok');
    expect(model.stateMachines).toHaveLength(0);
  });
});

// ── writeAction / deleteAction persistence ────────────────────────────────────

describe('writeAction and deleteAction — in-memory persistence (#179)', () => {
  let backend: InMemoryStorageBackend;
  const WS = wsId('dictionaries');

  beforeEach(() => {
    storageRegistry.reset();
    backend = new InMemoryStorageBackend();
    storageRegistry.setBackend(backend);
    // Seed the root directory so listPackages() can enumerate it.
    // Without this, statOrNull(pathOf('')) returns null and listPackages exits early.
    const ws = String(WS);
    if (!backend.files.has(ws)) backend.files.set(ws, new Map());
    const rootDirs = backend.dirs.get(ws) ?? new Set<string>();
    rootDirs.add('');
    backend.dirs.set(ws, rootDirs);
  });

  it('writeAction merges into the owner entity model file when it exists', async () => {
    const entity = makeEntity();
    const initial = YAML.stringify({ entities: [entity] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.model.yaml', initial],
    ]));

    const action = makeAction({ uuid: 'act-merge-001', name: 'cancel' });
    const result = await writeAction(action, 'order-service');
    expect(result.ok).toBe(true);

    // Should be merged INTO Order.model.yaml, not a new file
    const after = await backend.read(WS, 'order-service/Order.model.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0].uuid).toBe('act-merge-001');
  });

  it('writeAction creates a dedicated .actions.yaml file when no model file exists', async () => {
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
    ]));

    const action = makeAction({ uuid: 'act-new-file-001', name: 'refund' });
    const result = await writeAction(action, 'order-service');
    expect(result.ok).toBe(true);

    // A new file should have been created
    expect(result.physicalPath).toBeDefined();
    // Verify it can be read back
    const ws = backend.files.get('dictionaries')!;
    let foundAction = false;
    for (const [, content] of ws.entries()) {
      const parsed = YAML.parse(content);
      if (parsed?.actions && parsed.actions.some((a: Action) => a.uuid === 'act-new-file-001')) {
        foundAction = true;
        break;
      }
    }
    expect(foundAction).toBe(true);
  });

  it('writeAction updates an action in-place when it already exists in a file', async () => {
    const existingAction = makeAction({ uuid: 'act-update-001', name: 'cancel' });
    const initial = YAML.stringify({ actions: [existingAction] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.actions.yaml', initial],
    ]));

    const updated = { ...existingAction, description: 'Updated description' };
    const result = await writeAction(updated, 'order-service');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.actions.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0].description).toBe('Updated description');
  });

  it('deleteAction removes the action from its file', async () => {
    const action = makeAction({ uuid: 'act-del-001', name: 'cancel' });
    const other = makeAction({ uuid: 'act-del-002', name: 'refund' });
    const initial = YAML.stringify({ actions: [action, other] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.actions.yaml', initial],
    ]));

    const result = await deleteAction('act-del-001');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.actions.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0].uuid).toBe('act-del-002');
  });

  it('deleteAction deletes the file if it becomes empty after removal', async () => {
    const action = makeAction({ uuid: 'act-solo-001', name: 'cancel' });
    const initial = YAML.stringify({ actions: [action] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.actions.yaml', initial],
    ]));

    const result = await deleteAction('act-solo-001');
    expect(result.ok).toBe(true);

    const ws = backend.files.get('dictionaries')!;
    expect(ws.has('order-service/Order.actions.yaml')).toBe(false);
  });

  it('deleteAction returns ok:false when the UUID is not found', async () => {
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
    ]));

    const result = await deleteAction('nonexistent-uuid');
    expect(result.ok).toBe(false);
  });
});

// ── writeStateMachine / deleteStateMachine persistence ────────────────────────

describe('writeStateMachine and deleteStateMachine — in-memory persistence (#179)', () => {
  let backend: InMemoryStorageBackend;
  const WS = wsId('dictionaries');

  beforeEach(() => {
    storageRegistry.reset();
    backend = new InMemoryStorageBackend();
    storageRegistry.setBackend(backend);
    // Seed the root directory so listPackages() can enumerate it.
    const ws = String(WS);
    if (!backend.files.has(ws)) backend.files.set(ws, new Map());
    const rootDirs = backend.dirs.get(ws) ?? new Set<string>();
    rootDirs.add('');
    backend.dirs.set(ws, rootDirs);
  });

  it('writeStateMachine merges into the owner entity model file when it exists', async () => {
    const entity = makeEntity();
    const initial = YAML.stringify({ entities: [entity] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.model.yaml', initial],
    ]));

    const sm = makeStateMachine({ uuid: 'sm-merge-001', name: 'fulfillment' });
    const result = await writeStateMachine(sm, 'order-service');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.model.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.stateMachines).toHaveLength(1);
    expect(parsed.stateMachines[0].uuid).toBe('sm-merge-001');
  });

  it('writeStateMachine creates a dedicated .statemachine.yaml file when no model file exists', async () => {
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
    ]));

    const sm = makeStateMachine({ uuid: 'sm-new-file-001', name: 'fulfillment' });
    const result = await writeStateMachine(sm, 'order-service');
    expect(result.ok).toBe(true);

    const ws = backend.files.get('dictionaries')!;
    let found = false;
    for (const [, content] of ws.entries()) {
      const parsed = YAML.parse(content);
      if (parsed?.stateMachines && parsed.stateMachines.some((m: StateMachine) => m.uuid === 'sm-new-file-001')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('deleteStateMachine removes the machine from its file', async () => {
    const sm1 = makeStateMachine({ uuid: 'sm-del-001', name: 'fulfillment' });
    const sm2 = makeStateMachine({ uuid: 'sm-del-002', name: 'payment' });
    const initial = YAML.stringify({ stateMachines: [sm1, sm2] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.statemachine.yaml', initial],
    ]));

    const result = await deleteStateMachine('sm-del-001');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.statemachine.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.stateMachines).toHaveLength(1);
    expect(parsed.stateMachines[0].uuid).toBe('sm-del-002');
  });

  it('deleteStateMachine returns ok:false when UUID is not found', async () => {
    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
    ]));

    const result = await deleteStateMachine('nonexistent-uuid');
    expect(result.ok).toBe(false);
  });

  it('writeEntityFile preserves co-located actions and stateMachines in the same file', async () => {
    const entity = makeEntity();
    const action = makeAction();
    const sm = makeStateMachine();
    const initial = YAML.stringify({ entities: [entity], actions: [action], stateMachines: [sm] });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.model.yaml', initial],
    ]));

    // Update the entity — actions and stateMachines must be preserved
    const result = await writeEntityFile({ ...entity, description: 'updated description' }, 'order-service');
    expect(result.ok).toBe(true);

    const after = await backend.read(WS, 'order-service/Order.model.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.entities[0].description).toBe('updated description');
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0].uuid).toBe('act-test-001');
    expect(parsed.stateMachines).toHaveLength(1);
    expect(parsed.stateMachines[0].uuid).toBe('sm-test-001');
  });
});
