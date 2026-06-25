/**
 * EntityEventsTab — Events tab for the entity detail page (#201 Phase 2).
 *
 * Lists the first-class domain events owned by the entity and provides CRUD via
 * a side panel. Events promote `emitEvent` / `wait` from opaque names to modeled
 * elements; an event carries a name, description, and a payload modeled as
 * attributes. ADMIN/EDITOR users get Create / Edit / Delete affordances.
 *
 * Design-system only: `@/components/ui` primitives + design tokens.
 */

import { useState, useCallback } from 'react';
import type { Entity, Event, Attribute } from '../../../../types';
import { eventsApi } from '../../../../services/api';
import { Button, EmptyState, Icon, Input } from '../../../../components/ui';

interface EntityEventsTabProps {
  entity: Entity;
  events: Event[];
  onEventsChanged: () => void;
}

// ── Event side panel ──────────────────────────────────────────────────────────

interface EventPanelProps {
  event: Event | null;
  entityUuid: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Editor row — free-form name/type strings (cast to Attribute on save). */
interface PayloadAttr { name: string; type: string }

function EventPanel({ event, entityUuid, onClose, onSaved }: EventPanelProps) {
  const isNew = event === null;

  const [name, setName] = useState(event?.name ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [payload, setPayload] = useState<PayloadAttr[]>(
    (event?.payload ?? []).map((a) => ({ name: a.name, type: a.type })),
  );
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
      const payloadAttrs = payload
        .filter((p) => p.name.trim())
        .map((p) => ({ name: p.name.trim(), type: p.type || 'string' }) as Attribute);
      const body: Partial<Event> = {
        name: name.trim(),
        description: description.trim() || undefined,
        ownerRef: entityUuid,
        payload: payloadAttrs.length > 0 ? payloadAttrs : undefined,
      };
      if (isNew) {
        await eventsApi.create(body);
      } else if (event) {
        await eventsApi.update(event.uuid, body);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { errors?: { message: string }[]; message?: string } }; message?: string };
      setError(
        err.response?.data?.errors?.map((x) => x.message).join(' ') ||
          err.response?.data?.message ||
          err.message ||
          'Failed to save event',
      );
    } finally {
      setSaving(false);
    }
  }, [name, description, payload, entityUuid, isNew, event, onSaved, onClose]);

  const addAttr = () => setPayload((ps) => [...ps, { name: '', type: 'string' }]);
  const updateAttr = (i: number, field: 'name' | 'type', value: string) =>
    setPayload((ps) => ps.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  const removeAttr = (i: number) => setPayload((ps) => ps.filter((_, idx) => idx !== i));

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 440,
        background: 'var(--bg-raised)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', flex: 1 }}>
          {isNew ? 'New event' : 'Edit event'}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>Name *</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. order.cancelled" autoFocus />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{
              width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--fs-sm)', resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </label>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, flex: 1 }}>Payload</span>
            <Button size="sm" variant="ghost" icon="plus" onClick={addAttr}>Add field</Button>
          </div>
          {payload.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <Input value={p.name} onChange={(e) => updateAttr(i, 'name', e.target.value)} placeholder="field" />
              <Input value={p.type} onChange={(e) => updateAttr(i, 'type', e.target.value)} placeholder="type" />
              <button onClick={() => removeAttr(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
                <Icon name="delete" size={14} />
              </button>
            </div>
          ))}
          {payload.length === 0 && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>No payload fields</span>}
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</div>}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create' : 'Update'}
        </Button>
      </div>
    </div>
  );
}

// ── Main tab component ────────────────────────────────────────────────────────

export function EntityEventsTab({ entity, events, onEventsChanged }: EntityEventsTabProps) {
  const [selectedEvent, setSelectedEvent] = useState<Event | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = useCallback(async (event: Event) => {
    if (!confirm(`Delete event "${event.name}"? This cannot be undone.`)) return;
    setDeleting(event.uuid);
    try {
      await eventsApi.delete(event.uuid);
      onEventsChanged();
    } catch (e) {
      console.error('Failed to delete event:', e);
    } finally {
      setDeleting(null);
    }
  }, [onEventsChanged]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button size="sm" variant="primary" icon="plus" onClick={() => setSelectedEvent('new')}>
          New event
        </Button>
      </div>

      {events.length === 0 && (
        <EmptyState
          kind="empty"
          title="No events"
          message={`${entity.name} emits no modeled events yet. Events promote emitEvent / wait from opaque names to first-class elements.`}
          action={{ label: 'Add event', onClick: () => setSelectedEvent('new') }}
        />
      )}

      {events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {events.map((event) => (
            <div
              key={event.uuid}
              style={{
                border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-raised)',
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              }}
            >
              <Icon name="sparkle" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 600, flex: 1 }}>
                {event.name}
              </span>
              {event.payload && event.payload.length > 0 && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  {event.payload.length} field{event.payload.length === 1 ? '' : 's'}
                </span>
              )}
              {event.description && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', flex: 2 }}>{event.description}</span>
              )}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setSelectedEvent(event)} />
                <Button
                  size="sm"
                  variant="danger"
                  icon="delete"
                  disabled={deleting === event.uuid}
                  onClick={() => handleDelete(event)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedEvent !== null && (
        <EventPanel
          event={selectedEvent === 'new' ? null : selectedEvent}
          entityUuid={entity.uuid}
          onClose={() => setSelectedEvent(null)}
          onSaved={onEventsChanged}
        />
      )}
    </div>
  );
}
