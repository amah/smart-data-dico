/**
 * EntityActionsTab — Actions tab for the entity detail page (#179).
 *
 * Displays all actions owned by the entity in a table. Clicking a row
 * opens a side panel with the action's details and flow stepped-list.
 * ADMIN/EDITOR users get Create / Edit / Delete affordances.
 */

import { useState, useCallback } from 'react';
import type { Action, FlowStep, ActionParam, FlowStepKind, Entity } from '../../../../types';
import { FLOW_STEP_KINDS } from '../../../../types';
import { actionsApi } from '../../../../services/api';
import { Button, EmptyState, Icon } from '../../../../components/ui';
import { ActionFlowList } from './ActionFlowList';

interface EntityActionsTabProps {
  entity: Entity;
  actions: Action[];
  onActionsChanged: () => void;
}

// ── Action side panel ─────────────────────────────────────────────────────────

interface ActionPanelProps {
  action: Action | null;
  entityUuid: string;
  onClose: () => void;
  onSaved: () => void;
}

function ActionPanel({ action, entityUuid, onClose, onSaved }: ActionPanelProps) {
  const isNew = action === null;

  const [name, setName] = useState(action?.name ?? '');
  const [description, setDescription] = useState(action?.description ?? '');
  const [internal, setInternal] = useState(action?.internal ?? false);
  const [params, setParams] = useState<ActionParam[]>(action?.params ?? []);
  const [returnsType, setReturnsType] = useState(action?.returns?.type ?? '');
  const [flow, setFlow] = useState<FlowStep[]>(action?.flow ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<Action> = {
        name: name.trim(),
        description: description.trim() || undefined,
        ownerRef: entityUuid,
        internal,
        params,
        returns: returnsType ? { type: returnsType } : undefined,
        flow,
      };
      if (isNew) {
        await actionsApi.create(payload);
      } else if (action) {
        await actionsApi.update(action.uuid, payload);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save action');
    } finally {
      setSaving(false);
    }
  }, [name, description, internal, params, returnsType, flow, entityUuid, isNew, action, onSaved, onClose]);

  const addParam = () => setParams(ps => [...ps, { name: '', type: 'string', required: false }]);
  const updateParam = (i: number, field: keyof ActionParam, value: string | boolean) =>
    setParams(ps => ps.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  const removeParam = (i: number) => setParams(ps => ps.filter((_, idx) => idx !== i));

  const addFlowStep = (kind: FlowStepKind) => {
    const defaults: Record<FlowStepKind, FlowStep> = {
      assign:       { kind: 'assign',       target: '', value: '' },
      emitEvent:    { kind: 'emitEvent',    name: '' },
      invokeAction: { kind: 'invokeAction', actionRef: '' },
      branch:       { kind: 'branch',       when: '', then: [] },
      wait:         { kind: 'wait',         for: '' },
      callExternal: { kind: 'callExternal', target: '' },
    };
    setFlow(steps => [...steps, defaults[kind]]);
  };
  const removeFlowStep = (i: number) =>
    setFlow(steps => steps.filter((_, idx) => idx !== i));

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 480,
        background: 'var(--bg-raised)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', flex: 1 }}>
          {isNew ? 'New action' : 'Edit action'}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {/* Body — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Name */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>
            Name *
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 'var(--fs-sm)',
              boxSizing: 'border-box',
            }}
            placeholder="e.g. cancel"
          />
        </div>

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 'var(--fs-sm)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Internal flag */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>
          <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />
          <span>Internal (not exposed on public surface)</span>
        </label>

        {/* Returns */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>
            Returns type
          </label>
          <input
            value={returnsType}
            onChange={e => setReturnsType(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 'var(--fs-sm)',
              boxSizing: 'border-box',
            }}
            placeholder="void, string, Order, ..."
          />
        </div>

        {/* Params */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Params</span>
            <Button size="sm" variant="ghost" icon="add" onClick={addParam}>Add</Button>
          </div>
          {params.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input
                value={p.name}
                onChange={e => updateParam(i, 'name', e.target.value)}
                placeholder="name"
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 'var(--fs-xs)',
                }}
              />
              <input
                value={p.type}
                onChange={e => updateParam(i, 'type', e.target.value)}
                placeholder="type"
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 'var(--fs-xs)',
                }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)' }}>
                <input type="checkbox" checked={!!p.required} onChange={e => updateParam(i, 'required', e.target.checked)} />
                req
              </label>
              <button
                onClick={() => removeParam(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}
              >
                <Icon name="delete" size={14} />
              </button>
            </div>
          ))}
          {params.length === 0 && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>No params</span>
          )}
        </div>

        {/* Flow steps */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Flow</span>
          </div>

          {/* Step adder */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {FLOW_STEP_KINDS.map(kind => (
              <button
                key={kind}
                onClick={() => addFlowStep(kind)}
                style={{
                  padding: '2px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  background: 'var(--bg)',
                  color: 'var(--text-subtle)',
                  fontSize: 'var(--fs-xs)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                + {kind}
              </button>
            ))}
          </div>

          {/* Editable flow list — simplified inline rows for v1 */}
          {flow.map((step, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'flex-start',
                padding: '4px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 20 }}>
                {i + 1}.
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', color: 'var(--accent)', minWidth: 90 }}>
                {step.kind}
              </span>
              {step.kind === 'assign' && (
                <>
                  <input
                    value={step.target}
                    onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, target: e.target.value } as FlowStep : s))}
                    placeholder="target"
                    style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                  <input
                    value={step.value}
                    onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, value: e.target.value } as FlowStep : s))}
                    placeholder="value"
                    style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                </>
              )}
              {step.kind === 'emitEvent' && (
                <input
                  value={step.name}
                  onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, name: e.target.value } as FlowStep : s))}
                  placeholder="event name"
                  style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              )}
              {step.kind === 'invokeAction' && (
                <input
                  value={step.actionRef}
                  onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, actionRef: e.target.value } as FlowStep : s))}
                  placeholder="action UUID"
                  style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              )}
              {step.kind === 'branch' && (
                <input
                  value={step.when}
                  onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, when: e.target.value } as FlowStep : s))}
                  placeholder="when expression"
                  style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              )}
              {step.kind === 'wait' && (
                <input
                  value={step.for}
                  onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, for: e.target.value } as FlowStep : s))}
                  placeholder="event name or duration"
                  style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              )}
              {step.kind === 'callExternal' && (
                <input
                  value={step.target}
                  onChange={e => setFlow(steps => steps.map((s, idx) => idx === i ? { ...s, target: e.target.value } as FlowStep : s))}
                  placeholder="service.operation"
                  style={{ flex: 1, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3, fontSize: 'var(--fs-xs)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              )}
              <button
                onClick={() => removeFlowStep(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2, flexShrink: 0 }}
              >
                <Icon name="delete" size={12} />
              </button>
            </div>
          ))}
          {flow.length === 0 && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>No steps — click a kind above to add</span>
          )}
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create' : 'Update'}
        </Button>
      </div>
    </div>
  );
}

// ── Main tab component ────────────────────────────────────────────────────────

export function EntityActionsTab({ entity, actions, onActionsChanged }: EntityActionsTabProps) {
  const [selectedAction, setSelectedAction] = useState<Action | 'new' | null>(null);
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = useCallback(async (action: Action) => {
    if (!confirm(`Delete action "${action.name}"? This cannot be undone.`)) return;
    setDeleting(action.uuid);
    try {
      await actionsApi.delete(action.uuid);
      onActionsChanged();
    } catch (e) {
      console.error('Failed to delete action:', e);
    } finally {
      setDeleting(null);
    }
  }, [onActionsChanged]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, position: 'relative' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          size="sm"
          variant="primary"
          icon="add"
          onClick={() => setSelectedAction('new')}
        >
          New action
        </Button>
      </div>

      {/* Empty state */}
      {actions.length === 0 && (
        <EmptyState
          kind="empty"
          title="No actions"
          message={`${entity.name} has no actions yet. Actions model the behavior this entity exposes.`}
          action={{ label: 'Add action', onClick: () => setSelectedAction('new') }}
        />
      )}

      {/* Action rows */}
      {actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {actions.map(action => (
            <div
              key={action.uuid}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg-raised)',
                overflow: 'hidden',
              }}
            >
              {/* Row header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
                onClick={() => setExpandedUuid(x => x === action.uuid ? null : action.uuid)}
              >
                <Icon
                  name={expandedUuid === action.uuid ? 'chevronDown' : 'chevronRight'}
                  size={14}
                  style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 600, flex: 1 }}>
                  {action.name}
                  {action.internal && (
                    <span style={{ marginLeft: 8, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 400 }}>
                      internal
                    </span>
                  )}
                </span>
                {action.description && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', flex: 2 }}>
                    {action.description}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="edit"
                    onClick={(e) => { e.stopPropagation(); setSelectedAction(action); }}
                  />
                  <Button
                    size="sm"
                    variant="danger"
                    icon="delete"
                    disabled={deleting === action.uuid}
                    onClick={(e) => { e.stopPropagation(); handleDelete(action); }}
                  />
                </div>
              </div>

              {/* Expanded detail */}
              {expandedUuid === action.uuid && (
                <div style={{ padding: '0 12px 12px 32px', borderTop: '1px solid var(--border)' }}>
                  {/* Params */}
                  {action.params && action.params.length > 0 && (
                    <div style={{ marginBottom: 8, marginTop: 8 }}>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>Params</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {action.params.map((p, i) => (
                          <span
                            key={i}
                            style={{
                              padding: '1px 8px',
                              borderRadius: 12,
                              background: 'var(--bg-subtle)',
                              border: '1px solid var(--border)',
                              fontSize: 'var(--fs-xs)',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text)',
                            }}
                          >
                            {p.name}: {p.type}{p.required ? ' *' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Returns */}
                  {action.returns && (
                    <div style={{ marginBottom: 8, fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                      Returns: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{action.returns.type}</span>
                    </div>
                  )}
                  {/* Flow */}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 4 }}>Flow</div>
                    <ActionFlowList flow={action.flow ?? []} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Side panel */}
      {selectedAction !== null && (
        <ActionPanel
          action={selectedAction === 'new' ? null : selectedAction}
          entityUuid={entity.uuid}
          onClose={() => setSelectedAction(null)}
          onSaved={onActionsChanged}
        />
      )}
    </div>
  );
}
