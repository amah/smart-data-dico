/**
 * Unit tests for the AI concept-authoring tool cores (aiConceptTools.ts).
 * Services are mocked; we assert each core resolves entity names → uuids,
 * builds the right payload, maps both result conventions ({success}/{errors})
 * to MutationResult, and never throws on a service failure.
 */
import {
  executeCreateStereotype,
  executeCreateDerivedType,
  executeCreateRule,
  executeCreateCase,
  executeCreateEvent,
  executeCreateAction,
  executeCreateStateMachine,
  type ConceptServices,
} from '../aiConceptTools.js';

const ENTITY_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeServices(overrides: Partial<{
  findEntity: { entity: { uuid: string }; packageName: string } | null;
  createStereotypeResult: { success: boolean; errors?: string[] };
  createRuleResult: { success: boolean; errors?: string[]; rule?: any };
  createCaseResult: { success: boolean; errors?: string[]; case?: any };
  eventResult: any;
  actionResult: any;
  stateMachineResult: any;
  derivedList: any[];
  replaceResult: { success: boolean; errors?: string[] };
}> = {}): ConceptServices {
  const {
    findEntity = { entity: { uuid: ENTITY_UUID }, packageName: 'ordering' },
    createStereotypeResult = { success: true },
    createRuleResult = { success: true, rule: { uuid: 'r1' } },
    createCaseResult = { success: true, case: { uuid: 'c1' } },
    eventResult = { uuid: 'e1', name: 'OrderPlaced' },
    actionResult = { uuid: 'a1', name: 'PlaceOrder' },
    stateMachineResult = { uuid: 'sm1', name: 'OrderLifecycle' },
    derivedList = [],
    replaceResult = { success: true },
  } = overrides;

  return {
    serviceService: {
      findEntityAcrossPackages: jest.fn().mockResolvedValue(findEntity),
      getServiceEntities: jest.fn().mockResolvedValue([]),
    },
    stereotypeService: {
      createStereotype: jest.fn().mockResolvedValue(createStereotypeResult),
      getAllStereotypes: jest.fn().mockResolvedValue([]),
    },
    ruleService: { createRule: jest.fn().mockResolvedValue(createRuleResult) },
    caseService: { create: jest.fn().mockResolvedValue(createCaseResult) },
    eventService: { create: jest.fn().mockResolvedValue(eventResult) },
    actionService: { create: jest.fn().mockResolvedValue(actionResult) },
    stateMachineService: { create: jest.fn().mockResolvedValue(stateMachineResult) },
    derivedTypes: {
      list: jest.fn().mockResolvedValue(derivedList),
      replace: jest.fn().mockResolvedValue(replaceResult),
    },
  };
}

describe('executeCreateStereotype', () => {
  it('slugifies the id, defaults appliesTo=entity, persists, and returns a card', async () => {
    const services = makeServices();
    const r = await executeCreateStereotype({ id: 'Aggregate Root' }, services);
    expect(r.success).toBe(true);
    const arg = (services.stereotypeService.createStereotype as jest.Mock).mock.calls[0][0];
    expect(arg.id).toBe('aggregate-root');
    expect(arg.appliesTo).toBe('entity');
    expect(arg.name).toBe('Aggregate Root');
    if (r.success) { expect(r.elementType).toBe('stereotype'); expect(r.navigate).toBe('/stereotypes'); }
  });

  it('maps a service failure to {success:false} without throwing', async () => {
    const services = makeServices({ createStereotypeResult: { success: false, errors: ['dup id'] } });
    const r = await executeCreateStereotype({ id: 'pii' }, services);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('dup id');
  });
});

describe('executeCreateDerivedType', () => {
  it('upserts by name against the existing list and calls replace with the merged array', async () => {
    const services = makeServices({ derivedList: [{ name: 'money', basedOn: 'number' }] });
    const r = await executeCreateDerivedType({ name: 'email', basedOn: 'string', validation: { maxLength: 254 } }, services);
    expect(r.success).toBe(true);
    const merged = (services.derivedTypes.replace as jest.Mock).mock.calls[0][0];
    expect(merged.map((t: any) => t.name).sort()).toEqual(['email', 'money']);
    expect(merged.find((t: any) => t.name === 'email').validation).toEqual({ maxLength: 254 });
  });

  it('replaces an existing type of the same name (no duplicate)', async () => {
    const services = makeServices({ derivedList: [{ name: 'email', basedOn: 'string' }] });
    const r = await executeCreateDerivedType({ name: 'email', basedOn: 'string', validation: { maxLength: 200 } }, services);
    expect(r.success).toBe(true);
    if (r.success) expect(r.changeKind).toBe('updated');
    const merged = (services.derivedTypes.replace as jest.Mock).mock.calls[0][0];
    expect(merged.filter((t: any) => t.name === 'email')).toHaveLength(1);
  });
});

describe('executeCreateRule', () => {
  it('resolves entityName → entityUuid, sets entity scope + a target', async () => {
    const services = makeServices();
    const r = await executeCreateRule({ name: 'Active needs stock', description: 'active ⇒ stock>0', entityName: 'Product' }, services);
    expect(r.success).toBe(true);
    const arg = (services.ruleService.createRule as jest.Mock).mock.calls[0][0];
    expect(arg.scope).toBe('entity');
    expect(arg.entityUuid).toBe(ENTITY_UUID);
    expect(arg.name).toBe('active-needs-stock');
    expect(arg.severity).toBe('error');
    expect(arg.targets[0]).toMatchObject({ kind: 'entity', uuid: ENTITY_UUID });
  });

  it('fails clearly when neither entityName nor packageName is given', async () => {
    const services = makeServices();
    const r = await executeCreateRule({ name: 'x', description: 'y' }, services);
    expect(r.success).toBe(false);
  });

  it('fails when the entity cannot be resolved', async () => {
    const services = makeServices({ findEntity: null });
    const r = await executeCreateRule({ name: 'x', description: 'y', entityName: 'Ghost' }, services);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/not found/i);
  });
});

describe('executeCreateCase', () => {
  it('resolves all root entity names → uuids', async () => {
    const services = makeServices();
    const r = await executeCreateCase({ name: 'Checkout', rootEntityNames: ['Order', 'Product'] }, services);
    expect(r.success).toBe(true);
    const arg = (services.caseService.create as jest.Mock).mock.calls[0][0];
    expect(arg.rootEntities).toEqual([ENTITY_UUID, ENTITY_UUID]);
    if (r.success) expect(r.navigate).toBe('/cases/c1');
  });
});

describe('executeCreateEvent', () => {
  it('resolves the owner entity → ownerRef and persists', async () => {
    const services = makeServices();
    const r = await executeCreateEvent({ name: 'OrderPlaced', ownerEntityName: 'Order' }, services);
    expect(r.success).toBe(true);
    const arg = (services.eventService.create as jest.Mock).mock.calls[0][0];
    expect(arg.ownerRef).toBe(ENTITY_UUID);
    expect(arg.name).toBe('OrderPlaced');
  });

  it('maps the {errors} return convention to {success:false}', async () => {
    const services = makeServices({ eventResult: { errors: [{ field: 'name', message: 'dup' }] } });
    const r = await executeCreateEvent({ name: 'OrderPlaced', ownerEntityName: 'Order' }, services);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('dup');
  });
});

describe('executeCreateAction', () => {
  it('resolves owner, sets actionKind, and normalizes flow steps', async () => {
    const services = makeServices();
    const r = await executeCreateAction({
      name: 'PlaceOrder', ownerEntityName: 'Order', actionKind: 'command',
      flow: [{ kind: 'emitEvent', name: 'OrderPlaced' }, { kind: 'wait', for: 'PaymentConfirmed' }],
    }, services);
    expect(r.success).toBe(true);
    const arg = (services.actionService.create as jest.Mock).mock.calls[0][0];
    expect(arg.ownerRef).toBe(ENTITY_UUID);
    expect(arg.actionKind).toBe('command');
    expect(arg.flow).toEqual([
      { kind: 'emitEvent', name: 'OrderPlaced' },
      { kind: 'wait', for: 'PaymentConfirmed' },
    ]);
  });
});

describe('executeCreateStateMachine', () => {
  it('builds states/transitions (each transition gets a uuid) and resolves owner', async () => {
    const services = makeServices();
    const r = await executeCreateStateMachine({
      name: 'OrderLifecycle', ownerEntityName: 'Order', initialState: 'PENDING',
      states: [{ name: 'PENDING' }, { name: 'PAID' }, { name: 'CANCELLED', terminal: true }],
      transitions: [{ from: 'PENDING', to: 'PAID', on: 'pay' }, { from: '*', to: 'CANCELLED', on: 'cancel' }],
    }, services);
    expect(r.success).toBe(true);
    const arg = (services.stateMachineService.create as jest.Mock).mock.calls[0][0];
    expect(arg.ownerRef).toBe(ENTITY_UUID);
    expect(arg.initialState).toBe('PENDING');
    expect(arg.states).toHaveLength(3);
    expect(arg.transitions).toHaveLength(2);
    expect(arg.transitions.every((t: any) => typeof t.uuid === 'string' && t.uuid.length > 0)).toBe(true);
  });

  it('rejects an initialState that is not among the declared states', async () => {
    const services = makeServices();
    const r = await executeCreateStateMachine({
      name: 'SM', ownerEntityName: 'Order', initialState: 'NOPE',
      states: [{ name: 'PENDING' }],
    }, services);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/initialState/);
    expect((services.stateMachineService.create as jest.Mock)).not.toHaveBeenCalled();
  });
});
