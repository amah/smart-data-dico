/**
 * Derived Types page (#107).
 *
 * CRUD over `dico.config.json.types[]`. Simple table form — each row is a
 * `{ name, basedOn, description, validation }` entry. `basedOn` accepts
 * either a standard AttributeType or another derived type (transitive
 * resolution is handled by the backend validator).
 */
import { useEffect, useState } from 'react';
import { configApi, DerivedType } from '../services/api';
import { AttributeType } from '../types';

const STANDARD_TYPES = Object.values(AttributeType);

interface Row extends DerivedType {
  _pattern?: string;
  _minLength?: string;
  _maxLength?: string;
  _precision?: string;
  _scale?: string;
}

function fromApi(dt: DerivedType): Row {
  return {
    ...dt,
    _pattern: dt.validation?.pattern || '',
    _minLength: dt.validation?.minLength?.toString() || '',
    _maxLength: dt.validation?.maxLength?.toString() || '',
    _precision: dt.validation?.precision?.toString() || '',
    _scale: dt.validation?.scale?.toString() || '',
  };
}

function toApi(row: Row): DerivedType {
  const v: DerivedType['validation'] = {};
  if (row._pattern) v.pattern = row._pattern;
  if (row._minLength) v.minLength = Number(row._minLength);
  if (row._maxLength) v.maxLength = Number(row._maxLength);
  if (row._precision) v.precision = Number(row._precision);
  if (row._scale) v.scale = Number(row._scale);
  const out: DerivedType = {
    name: row.name,
    basedOn: row.basedOn,
    description: row.description,
  };
  if (Object.keys(v).length > 0) out.validation = v;
  return out;
}

const DerivedTypesPage = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const types = await configApi.getDerivedTypes();
      setRows(types.map(fromApi));
    } catch (e: any) {
      setErrors([`Failed to load: ${e?.message || e}`]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addRow = () => {
    setRows([...rows, fromApi({ name: '', basedOn: 'string' })]);
  };

  const removeRow = (idx: number) => {
    setRows(rows.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows(rows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    setMessage(null);
    try {
      const payload = rows.map(toApi);
      await configApi.putDerivedTypes(payload);
      setMessage('Saved.');
      await load();
    } catch (e: any) {
      const resp = e?.response?.data;
      if (resp?.errors) setErrors(resp.errors);
      else setErrors([resp?.message || e?.message || 'Save failed']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Derived Data Types</h1>
          <p className="text-sm text-base-content/70">
            Reusable, named types built on standard AttributeTypes. Available
            alongside the standard set in the attribute-type picker.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={addRow}>Add Type</button>
          <button className="btn btn-success" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {message && <div className="alert alert-success mb-4">{message}</div>}
      {errors.length > 0 && (
        <div className="alert alert-error mb-4">
          <ul className="list-disc ml-4">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-base-content/60 italic">
          No derived types yet. Click <span className="font-semibold">Add Type</span> to create one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Based On</th>
                <th>Description</th>
                <th>Pattern</th>
                <th>minLength</th>
                <th>maxLength</th>
                <th>precision</th>
                <th>scale</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const basedOnOptions = [
                  ...STANDARD_TYPES,
                  ...rows.filter(o => o.name && o.name !== r.name).map(o => o.name),
                ];
                return (
                  <tr key={idx}>
                    <td>
                      <input
                        className="input input-bordered input-sm w-40"
                        placeholder="email"
                        value={r.name}
                        onChange={e => updateRow(idx, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="select select-bordered select-sm w-40"
                        value={r.basedOn}
                        onChange={e => updateRow(idx, { basedOn: e.target.value })}
                      >
                        {basedOnOptions.map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-sm w-56"
                        value={r.description || ''}
                        onChange={e => updateRow(idx, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-sm w-48 font-mono"
                        value={r._pattern || ''}
                        onChange={e => updateRow(idx, { _pattern: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-sm w-20"
                        value={r._minLength || ''}
                        onChange={e => updateRow(idx, { _minLength: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-sm w-20"
                        value={r._maxLength || ''}
                        onChange={e => updateRow(idx, { _maxLength: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-sm w-20"
                        value={r._precision || ''}
                        onChange={e => updateRow(idx, { _precision: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-sm w-20"
                        value={r._scale || ''}
                        onChange={e => updateRow(idx, { _scale: e.target.value })}
                      />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-xs text-error" onClick={() => removeRow(idx)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DerivedTypesPage;
