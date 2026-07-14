import { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useParams } from 'react-router-dom';
import { useService } from '../../../../kernel/useService';
import { DOCUMENTATION_SERVICE_TOKEN } from '../../../../kernel/tokens';
import type { DocumentationService } from '../../services/DocumentationService';
import type { Documentation, DocumentationScope, DocumentationStatus } from '../../../../types';
import { Button, Chip, EmptyState, Input, Modal, Toolbar } from '../../../../components/ui';

const statuses: Array<DocumentationStatus | 'all'> = ['all', 'draft', 'review', 'approved', 'deprecated'];

const DocumentationBrowserPage = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const service = useService<DocumentationService>(DOCUMENTATION_SERVICE_TOKEN);
  const [documents, setDocuments] = useState<Documentation[]>([]);
  const [selected, setSelected] = useState<Documentation | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<DocumentationScope | 'all'>('all');
  const [status, setStatus] = useState<DocumentationStatus | 'all'>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocuments(await service.list({
        scope: scope === 'all' ? undefined : scope,
        status: status === 'all' ? undefined : status,
      }));
    } catch {
      setError('Failed to load documentation.');
    } finally {
      setLoading(false);
    }
  }, [scope, service, status]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!uuid) return;
    const match = documents.find(document => document.uuid === uuid);
    if (match) setSelected(match);
  }, [documents, uuid]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter(document => [
      document.title,
      document.summary,
      document.packageName,
      ...(document.tags ?? []),
      ...(document.concepts ?? []),
    ].some(value => value?.toLowerCase().includes(query)));
  }, [documents, search]);
  useEffect(() => {
    if (selected && !filtered.some(document => document.uuid === selected.uuid)) setSelected(null);
  }, [filtered, selected]);

  const save = async (draft: Documentation) => {
    const saved = await service.update(draft.uuid, draft);
    setSelected(saved);
    setEditing(false);
    await reload();
  };

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1 }}>
      <Toolbar attached>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>Business documentation</h1>
        <Chip tone="neutral" soft>{filtered.length}</Chip>
        <Toolbar.Spacer />
        <select value={scope} onChange={event => setScope(event.target.value as DocumentationScope | 'all')}>
          <option value="all">All scopes</option><option value="project">Project</option><option value="package">Package</option>
        </select>
        <select value={status} onChange={event => setStatus(event.target.value as DocumentationStatus | 'all')}>
          {statuses.map(value => <option key={value} value={value}>{value === 'all' ? 'All statuses' : value}</option>)}
        </select>
        <Input size="sm" icon="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search documentation" />
      </Toolbar>

      {error && <div style={{ padding: 16, color: 'var(--danger)' }}>{error}</div>}
      {!loading && filtered.length === 0 ? <EmptyState title="No documentation" message="Add Markdown files under a project or package documentation directory." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 34%) 1fr', minHeight: 0, flex: 1 }}>
          <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }}>
            {filtered.map(document => (
              <button key={document.uuid} type="button" onClick={() => { setSelected(document); setEditing(false); }} style={{ display: 'block', width: '100%', padding: 14, textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', background: selected?.uuid === document.uuid ? 'var(--surface-hover)' : 'transparent', color: 'inherit', cursor: 'pointer' }}>
                <strong>{document.title}</strong>
                <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{document.summary}</div>
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                  <Chip tone="meta" soft>{document.scope}</Chip>
                  {document.packageName && <Chip tone="neutral" soft>{document.packageName}</Chip>}
                  {document.status && <Chip tone={document.status === 'deprecated' ? 'warning' : 'neutral'} soft>{document.status}</Chip>}
                </div>
              </button>
            ))}
          </div>
          <div style={{ overflow: 'auto', padding: '20px 28px' }}>
            {!selected ? <EmptyState title="Select a document" message="Choose a document to read its business context and provenance." /> : (
              <>
                <div style={{ display: 'flex', alignItems: 'start', gap: 12 }}>
                  <div><h2 style={{ margin: 0 }}>{selected.title}</h2><div className="mono" style={{ color: 'var(--text-subtle)', marginTop: 6 }}>{selected.sourcePath}</div></div>
                  <Toolbar.Spacer /><Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                </div>
                <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' }} />
                <Markdown remarkPlugins={[remarkGfm]}>{selected.content.replace(/^\s*<!--\s*chunk:\s*[A-Za-z0-9][\w.-]*\s*-->\s*$/gm, '')}</Markdown>
              </>
            )}
          </div>
        </div>
      )}
      {selected && <DocumentationEditor open={editing} document={selected} onClose={() => setEditing(false)} onSave={save} />}
    </div>
  );
};

const DocumentationEditor = ({ open, document, onClose, onSave }: { open: boolean; document: Documentation; onClose: () => void; onSave: (document: Documentation) => Promise<void> }) => {
  const [draft, setDraft] = useState(document);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(document), [document]);
  return <Modal open={open} title={`Edit ${document.title}`} onClose={onClose} width={920}>
    <div style={{ display: 'grid', gap: 12 }}>
      <label>Title<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} style={{ width: '100%' }} /></label>
      <label>Summary<textarea rows={2} value={draft.summary ?? ''} onChange={event => setDraft({ ...draft, summary: event.target.value })} style={{ width: '100%' }} /></label>
      <label>Markdown<textarea rows={20} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} className="mono" style={{ width: '100%', resize: 'vertical' }} /></label>
      <div style={{ display: 'flex', justifyContent: 'end', gap: 8 }}><Button onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}>{saving ? 'Saving…' : 'Save'}</Button></div>
    </div>
  </Modal>;
};

export default DocumentationBrowserPage;
