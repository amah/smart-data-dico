/**
 * EntityStateMachinesTab — State machines tab for the entity detail page (#179).
 *
 * One card per machine. Each card shows:
 *   - Machine name + stateAttribute binding
 *   - Read-only Cytoscape diagram
 *   - Transition table (from → to, event, guard, invoke)
 * ADMIN/EDITOR users get Create / Edit / Delete affordances.
 * Form-based editor appears in a side panel.
 */

import { useState, useCallback } from 'react';
import type { StateMachine, SMState, Transition, Entity } from '../../../../types';
import { stateMachinesApi } from '../../../../services/api';
import { Button, EmptyState, Icon } from '../../../../components/ui';
import { StateMachineDiagram } from './StateMachineDiagram';

interface EntityStateMachinesTabProps {
  entity: Entity;
  machines: StateMachine[];
  onMachinesChanged: () => void;
}

// ── Side-panel editor ─────────────────────────────────────────────────────────

interface StateMachinePanelProps {
  machine: StateMachine | null;
  entityUuid: string;
  onClose: () => void;
  onSaved: () => void;
}

function StateMachinePanel({ machine, entityUuid, onClose, onSaved }: StateMachinePanelProps) {
  const isNew = machine === null;

  const [name, setName] = useState(machine?.name ?? '');
  const [description, setDescription] = useState(machine?.description ?? '');
  const [stateAttribute, setStateAttribute] = useState(machine?.stateAttribute ?? '');
  const [initialState, setInitialState] = useState(machine?.initialState ?? '');
  const [states, setStates] = useState<SMState[]>(machine?.states ?? []);
  const [transitions, setTransitions] = useState<Transition[]>(machine?.transitions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addState = () => setStates(ss => [...ss, { name: '' }]);
  const updateState = (i: number, field: keyof SMState, value: string | boolean) =>
    setStates(ss => ss.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  const removeState = (i: number) => setStates(ss => ss.filter((_, idx) => idx !== i));

  const addTransition = () => setTransitions(ts => [
    ...ts,
    { uuid: crypto.randomUUID(), from: '', to: '', on: '', invoke: [] },
  ]);
  const updateTransition = (i: number, field: keyof Transition, value: string | string[]) =>
    setTransitions(ts => ts.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  const removeTransition = (i: number) => setTransitions(ts => ts.filter((_, idx) => idx !== i));

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!initialState.trim()) { setError('Initial state is required'); return; }
    if (states.length === 0) { setError('At least one state is required'); return; }

    setSaving(true);
    setError(null);
    try {
      const payload: Partial<StateMachine> = {
        name: name.trim(),
        description: description.trim() || undefined,
        ownerRef: entityUuid,
        stateAttribute: stateAttribute.trim() || undefined,
        initialState: initialState.trim(),
        states: states.filter(s => s.name.trim()),
        transitions,
      };
      if (isNew) {
        await stateMachinesApi.create(payload);
      } else if (machine) {
        await stateMachinesApi.update(machine.uuid, payload);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save state machine');
    } finally {
      setSaving(false);
    }
  }, [name, description, stateAttribute, initialState, states, transitions, entityUuid, isNew, machine, onSaved, onClose]);

  const inputStyle = {
    width: '100%',
    padding: '5px 8px',
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 'var(--fs-sm)',
    boxSizing: 'border-box' as const,
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 520,
        background: 'var(--bg-raised)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', flex: 1 }}>
          {isNew ? 'New state machine' : 'Edit state machine'}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
          <Icon name="close" size={16} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Name */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. fulfillment" />
        </div>

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        {/* State attribute */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>
            State attribute (optional — attribute name on entity that tracks current state)
          </label>
          <input value={stateAttribute} onChange={e => setStateAttribute(e.target.value)} style={inputStyle} placeholder="e.g. status" />
        </div>

        {/* Initial state */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>Initial state *</label>
          <input value={initialState} onChange={e => setInitialState(e.target.value)} style={inputStyle} placeholder="e.g. PENDING" />
        </div>

        {/* States */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>States</span>
            <Button size="sm" variant="ghost" icon="add" onClick={addState}>Add</Button>
          </div>
          {states.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input
                value={s.name}
                onChange={e => updateState(i, 'name', e.target.value)}
                placeholder="state name"
                style={{ flex: 1, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={!!s.terminal} onChange={e => updateState(i, 'terminal', e.target.checked)} />
                terminal
              </label>
              <button onClick={() => removeState(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
                <Icon name="delete" size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Transitions */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Transitions</span>
            <Button size="sm" variant="ghost" icon="add" onClick={addTransition}>Add</Button>
          </div>
          {transitions.map((t, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input
                  value={t.from}
                  onChange={e => updateTransition(i, 'from', e.target.value)}
                  placeholder='from (* for any)'
                  style={{ flex: 1, padding: '3px 5px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}
                />
                <span style={{ fontSize: 'var(--fs-xs)', alignSelf: 'center', color: 'var(--text-muted)' }}>→</span>
                <input
                  value={t.to}
                  onChange={e => updateTransition(i, 'to', e.target.value)}
                  placeholder="to"
                  style={{ flex: 1, padding: '3px 5px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}
                />
                <button onClick={() => removeTransition(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
                  <Icon name="delete" size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={t.on}
                  onChange={e => updateTransition(i, 'on', e.target.value)}
                  placeholder="event (on)"
                  style={{ flex: 1, padding: '3px 5px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-xs)' }}
                />
                <input
                  value={t.guard ?? ''}
                  onChange={e => updateTransition(i, 'guard', e.target.value)}
                  placeholder="guard (optional)"
                  style={{ flex: 1, padding: '3px 5px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-xs)' }}
                />
              </div>
              <div style={{ marginTop: 4 }}>
                <input
                  value={(t.invoke ?? []).join(', ')}
                  onChange={e => updateTransition(i, 'invoke', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="invoke: action UUIDs, comma-separated"
                  style={{ width: '100%', padding: '3px 5px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-xs)', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          ))}
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</div>}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create' : 'Update'}
        </Button>
      </div>
    </div>
  );
}

// ── Machine card ──────────────────────────────────────────────────────────────

function MachineSummary({ sm }: { sm: StateMachine }) {
  return (
    <div style={{ padding: '0 0 8px 0' }}>
      {sm.stateAttribute && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 8 }}>
          Bound to attribute: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{sm.stateAttribute}</span>
        </div>
      )}
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 8 }}>
        Initial: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{sm.initialState}</span>
        {' · '}
        {sm.states.length} state{sm.states.length !== 1 ? 's' : ''}
        {' · '}
        {sm.transitions.length} transition{sm.transitions.length !== 1 ? 's' : ''}
      </div>

      {/* Cytoscape diagram */}
      <StateMachineDiagram sm={sm} height={280} />

      {/* Transitions table */}
      {sm.transitions.length > 0 && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['From', 'To', 'Event', 'Guard', 'Invoke'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-subtle)', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sm.transitions.map((t) => (
                <tr key={t.uuid} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{t.from}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{t.to}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--text)' }}>{t.on}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--text-subtle)', fontStyle: t.guard ? 'normal' : 'italic' }}>
                    {t.guard ?? '—'}
                  </td>
                  <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-subtle)', fontSize: 'calc(var(--fs-xs) - 1px)' }}>
                    {(t.invoke ?? []).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function EntityStateMachinesTab({ entity, machines, onMachinesChanged }: EntityStateMachinesTabProps) {
  const [panelMachine, setPanelMachine] = useState<StateMachine | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedUuid, setExpandedUuid] = useState<string | null>(
    machines.length === 1 ? machines[0].uuid : null,
  );

  const handleDelete = useCallback(async (sm: StateMachine) => {
    if (!confirm(`Delete state machine "${sm.name}"? This cannot be undone.`)) return;
    setDeleting(sm.uuid);
    try {
      await stateMachinesApi.delete(sm.uuid);
      onMachinesChanged();
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  }, [onMachinesChanged]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, position: 'relative' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button size="sm" variant="primary" icon="add" onClick={() => setPanelMachine('new')}>
          New state machine
        </Button>
      </div>

      {/* Empty state */}
      {machines.length === 0 && (
        <EmptyState
          kind="empty"
          title="No state machines"
          message={`${entity.name} has no state machines yet. State machines model the lifecycle states an entity can be in.`}
          action={{ label: 'Add state machine', onClick: () => setPanelMachine('new') }}
        />
      )}

      {/* Machine cards */}
      {machines.map(sm => (
        <div
          key={sm.uuid}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-raised)',
            marginBottom: 12,
            overflow: 'hidden',
          }}
        >
          {/* Card header */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer' }}
            onClick={() => setExpandedUuid(x => x === sm.uuid ? null : sm.uuid)}
          >
            <Icon
              name={expandedUuid === sm.uuid ? 'chevronDown' : 'chevronRight'}
              size={14}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', flex: 1, fontFamily: 'var(--font-mono)' }}>
              {sm.name}
            </span>
            {sm.description && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', flex: 2 }}>
                {sm.description}
              </span>
            )}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <Button size="sm" variant="ghost" icon="edit" onClick={e => { e.stopPropagation(); setPanelMachine(sm); }} />
              <Button
                size="sm"
                variant="danger"
                icon="delete"
                disabled={deleting === sm.uuid}
                onClick={e => { e.stopPropagation(); handleDelete(sm); }}
              />
            </div>
          </div>

          {/* Card body */}
          {expandedUuid === sm.uuid && (
            <div style={{ padding: '4px 14px 14px' }}>
              <MachineSummary sm={sm} />
            </div>
          )}
        </div>
      ))}

      {/* Side panel */}
      {panelMachine !== null && (
        <StateMachinePanel
          machine={panelMachine === 'new' ? null : panelMachine}
          entityUuid={entity.uuid}
          onClose={() => setPanelMachine(null)}
          onSaved={onMachinesChanged}
        />
      )}
    </div>
  );
}
