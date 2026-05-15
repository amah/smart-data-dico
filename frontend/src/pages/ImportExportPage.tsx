import { useState, useEffect } from 'react';
import { servicesApi } from '../services/api';
import { useCommand } from '../kernel/useCommand';
import SchemaImportWizard from '../components/SchemaImportWizard';
import Breadcrumbs from '../components/Breadcrumbs';
import { PageHeader } from '../components/ui';

export default function ImportExportPage() {
  const run = useCommand();
  const [activeTab, setActiveTab] = useState<'wizard' | 'import' | 'export'>('wizard');
  const [services, setServices] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState('');
  const [importFormat, setImportFormat] = useState<'json-schema' | 'sql-ddl'>('json-schema');
  const [importText, setImportText] = useState('');
  const [exportFormat, setExportFormat] = useState<'json-schema' | 'markdown'>('json-schema');
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    servicesApi.getAllServices().then(r => setServices(r.data)).catch(() => {});
  }, []);

  const handleImport = async () => {
    if (!importText.trim() || !selectedService) return;
    setLoading(true);
    setResult(null);
    try {
      let res;
      if (importFormat === 'json-schema') {
        const schema = JSON.parse(importText);
        res = await run('data-dictionary.import-export.importJsonSchema', { schema, service: selectedService });
      } else {
        res = await run('data-dictionary.import-export.importSqlDdl', { sql: importText, service: selectedService });
      }
      const count = res.data?.entities?.length || 0;
      const errors = res.data?.errors || [];
      setResult({
        type: errors.length > 0 ? 'error' : 'success',
        text: `Imported ${count} entities.${errors.length > 0 ? ` Errors: ${errors.join(', ')}` : ''}`,
      });
    } catch (err: any) {
      setResult({ type: 'error', text: err.message || 'Import failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selectedService) return;
    setLoading(true);
    setResult(null);
    try {
      if (exportFormat === 'json-schema') {
        const schema = await run('data-dictionary.import-export.exportJsonSchema', { service: selectedService });
        const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `${selectedService}-schema.json`);
      } else {
        const md = await run('data-dictionary.import-export.exportMarkdown', { service: selectedService });
        const blob = new Blob([md], { type: 'text/markdown' });
        downloadBlob(blob, `${selectedService}-data-dictionary.md`);
      }
      setResult({ type: 'success', text: 'Export downloaded.' });
    } catch (err: any) {
      setResult({ type: 'error', text: err.message || 'Export failed' });
    } finally {
      setLoading(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(reader.result as string);
    reader.readAsText(file);
  };

  return (
    <div className="px-4 pb-4 max-w-3xl space-y-4" style={{ paddingTop: 5 }}>
      <PageHeader
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: 'Home', path: '/' },
              { label: 'Import & Export', path: '/import-export' },
            ]}
          />
        }
        tabs={
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 2,
              background: 'var(--bg-raised)',
              gap: 2,
            }}
          >
            {([
              { id: 'wizard', label: 'Wizard' },
              { id: 'import', label: 'Import' },
              { id: 'export', label: 'Export' },
            ] as const).map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    padding: '2px 10px',
                    fontSize: 'var(--fs-sm)',
                    borderRadius: 4,
                    border: 'none',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-subtle)',
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        }
      />

      {result && (
        <div className={`alert ${result.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          <span>{result.text}</span>
        </div>
      )}

      {activeTab === 'wizard' && (
        <SchemaImportWizard
          services={services}
          onComplete={() => {
            // Refresh service list in case the import created new services
            servicesApi.getAllServices().then(r => setServices(r.data)).catch(() => {});
          }}
        />
      )}

      {/* Service selector — shared by JSON Schema import + Export tabs.
          The wizard tab has its own selector. */}
      {activeTab !== 'wizard' && (
        <div className="form-control">
          <label className="label"><span className="label-text">Target Service</span></label>
          <select className="select select-bordered" value={selectedService} onChange={e => setSelectedService(e.target.value)}>
            <option value="">Select a service...</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {activeTab === 'import' && (
        <div className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Format</span></label>
            <select className="select select-bordered" value={importFormat} onChange={e => setImportFormat(e.target.value as any)}>
              <option value="json-schema">JSON Schema</option>
              <option value="sql-ddl">SQL DDL (CREATE TABLE)</option>
            </select>
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Upload File or Paste</span></label>
            <input type="file" className="file-input file-input-bordered file-input-sm" accept=".json,.sql,.txt" onChange={handleFileUpload} />
          </div>

          <div className="form-control">
            <textarea
              className="textarea textarea-bordered font-mono text-sm"
              rows={12}
              placeholder={importFormat === 'json-schema'
                ? '{"definitions": {"User": {"type": "object", "properties": {"name": {"type": "string"}}}}}'
                : 'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(100) NOT NULL\n);'}
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" onClick={handleImport} disabled={loading || !importText.trim() || !selectedService}>
            {loading && <span className="loading loading-spinner loading-sm" />}
            Import
          </button>
        </div>
      )}

      {activeTab === 'export' && (
        <div className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Format</span></label>
            <select className="select select-bordered" value={exportFormat} onChange={e => setExportFormat(e.target.value as any)}>
              <option value="json-schema">JSON Schema</option>
              <option value="markdown">Markdown Documentation</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={handleExport} disabled={loading || !selectedService}>
            {loading && <span className="loading loading-spinner loading-sm" />}
            Export & Download
          </button>
        </div>
      )}
    </div>
  );
}
