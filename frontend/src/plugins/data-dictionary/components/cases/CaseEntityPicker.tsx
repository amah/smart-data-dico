import { useState, useEffect } from 'react';
import { entityApi } from '../../../../services/api';
import type { Package } from '../../../../types';

interface CaseEntityPickerProps {
  selected: string[];
  onChange: (uuids: string[]) => void;
}

interface FlatEntity {
  uuid: string;
  name: string;
  service: string;
}

export default function CaseEntityPicker({ selected, onChange }: CaseEntityPickerProps) {
  const [entities, setEntities] = useState<FlatEntity[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const packages = await entityApi.getAllPackages();
        const flat: FlatEntity[] = [];
        const walk = (pkgs: Package[], serviceName?: string) => {
          for (const pkg of pkgs) {
            const svc = serviceName || pkg.name;
            if (pkg.entities) {
              for (const e of pkg.entities) {
                flat.push({ uuid: e.uuid, name: e.name, service: svc });
              }
            }
            if (pkg.subPackages) walk(pkg.subPackages, svc);
          }
        };
        walk(packages);
        setEntities(flat);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toggle = (uuid: string) => {
    if (selected.includes(uuid)) {
      onChange(selected.filter((u) => u !== uuid));
    } else {
      onChange([...selected, uuid]);
    }
  };

  const filtered = search
    ? entities.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()) || e.service.toLowerCase().includes(search.toLowerCase()))
    : entities;

  // Group by service
  const grouped = new Map<string, FlatEntity[]>();
  for (const e of filtered) {
    if (!grouped.has(e.service)) grouped.set(e.service, []);
    grouped.get(e.service)!.push(e);
  }

  if (loading) return <span className="loading loading-spinner loading-sm" />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="input input-bordered input-sm flex-1"
          placeholder="Search entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-base-content/60">{selected.length} selected</span>
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((uuid) => {
            const e = entities.find((x) => x.uuid === uuid);
            return (
              <span key={uuid} className="badge badge-primary badge-sm gap-1">
                {e?.name || uuid.slice(0, 8)}
                <button className="text-xs" onClick={() => toggle(uuid)}>&times;</button>
              </span>
            );
          })}
        </div>
      )}

      {/* Entity list */}
      <div className="max-h-60 overflow-y-auto border border-base-300 rounded p-2 space-y-2">
        {[...grouped.entries()].map(([service, ents]) => (
          <div key={service}>
            <div className="text-xs font-semibold text-base-content/60 mb-1">{service}</div>
            {ents.map((e) => (
              <label key={e.uuid} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-base-200 rounded px-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-primary"
                  checked={selected.includes(e.uuid)}
                  onChange={() => toggle(e.uuid)}
                />
                <span className="text-sm">{e.name}</span>
              </label>
            ))}
          </div>
        ))}
        {filtered.length === 0 && <p className="text-xs text-base-content/50">No entities found.</p>}
      </div>
    </div>
  );
}
