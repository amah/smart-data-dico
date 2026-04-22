import { useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react';
import { entityApi, servicesApi } from '../services/api';
import { Attribute, AttributeType, Package, Entity } from '../types';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import EditableCell from './EditableCell';
import type { SelectOption } from './EditableCell';
import {
  Chip,
  ColumnChooser,
  Icon,
  Toolbar,
  TypeChip,
} from './ui';
import type { ColumnDef } from './ui';

/**
 * AttributeFlatTable — Phase 4.1 redesign (chrome only).
 *
 * Inline editing via EditableCell (→ `<td>` DOM) is preserved so the
 * existing test suite keeps working; only the surrounding Toolbar /
 * header / chip rendering is updated to the new token grammar.
 *
 * The ColumnChooser primitive drives metadata-column visibility; the
 * base Attribute / Entity / Package columns are always visible.
 */

interface FlatAttribute {
  attribute: Attribute;
  entityName: string;
  entityUuid: string;
  packageName: string;
}

const ATTRIBUTE_TYPE_OPTIONS: SelectOption[] = Object.values(AttributeType).map((t) => ({
  value: t,
  label: t,
}));

const AttributeFlatTable = () => {
  const [attributes, setAttributes] = useState<FlatAttribute[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { allColumns, columnsByStereotype } = useStereotypeMetadata('attribute');
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());

  const fetchAttributes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
      const flatAttrs: FlatAttribute[] = [];
      for (const pkg of pkgs) {
        if (pkg.entities) {
          for (const entity of pkg.entities) {
            if (entity.attributes) {
              for (const attr of entity.attributes) {
                flatAttrs.push({
                  attribute: attr,
                  entityName: entity.name,
                  entityUuid: entity.uuid,
                  packageName: pkg.name,
                });
              }
            }
          }
        }
      }
      setAttributes(flatAttrs);
    } catch {
      setError('Failed to load attributes. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAttributes();
  }, [fetchAttributes]);

  useEffect(() => {
    if (attributes.length > 0 && allColumns.length > 0) {
      const usedKeys = new Set<string>();
      for (const { attribute } of attributes) {
        for (const entry of attribute.metadata || []) {
          usedKeys.add(entry.name);
        }
      }
      setVisibleColumns(usedKeys);
    }
  }, [attributes, allColumns]);

  const activeMetaCols = allColumns.filter(c => visibleColumns.has(c.name));

  /** ColumnChooser needs a ColumnDef<unknown>[] — shape the metadata list to match. */
  const chooserColumns = useMemo<ColumnDef<unknown>[]>(() => {
    return allColumns.map((col) => ({
      key: col.name,
      header: col.label,
      group: 'metadata',
      width: 120,
    }));
  }, [allColumns]);
  void columnsByStereotype;

  const saveAttribute = useCallback(async (
    packageName: string,
    entityName: string,
    entityUuid: string,
    attrUuid: string,
    updater: (attr: Attribute) => Attribute,
  ) => {
    const pkg = packages.find(p => p.name === packageName);
    const entity = pkg?.entities?.find(e => e.uuid === entityUuid);
    if (!entity) throw new Error('Entity not found');

    const updatedAttributes = entity.attributes.map(a =>
      a.uuid === attrUuid ? updater(a) : a,
    );
    const updatedEntity: Entity = { ...entity, attributes: updatedAttributes };

    await servicesApi.updateEntity(packageName, entityName, updatedEntity);

    setAttributes(prev => prev.map(fa => {
      if (fa.attribute.uuid === attrUuid && fa.entityUuid === entityUuid) {
        return { ...fa, attribute: updater(fa.attribute) };
      }
      return fa;
    }));
    setPackages(prev => prev.map(p => {
      if (p.name !== packageName) return p;
      return {
        ...p,
        entities: p.entities?.map(e =>
          e.uuid === entityUuid ? updatedEntity : e,
        ),
      };
    }));
  }, [packages]);

  const renderMetaDisplay = (attr: Attribute, col: MetadataColumn) => {
    const val = getMetadataValue(attr, col.name);
    if (val === undefined || val === '') return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
    if (col.type === 'flag' || col.type === 'boolean') {
      return val
        ? <Chip tone="success" soft>yes</Chip>
        : <Chip tone="neutral">no</Chip>;
    }
    return <span style={{ fontSize: 'var(--fs-sm)' }}>{val.toString()}</span>;
  };

  const getMetaInputType = (col: MetadataColumn): 'text' | 'toggle' | 'select' => {
    if (col.type === 'flag' || col.type === 'boolean') return 'toggle';
    return 'text';
  };

  // ──────────────── Render ────────────────

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1 }}>
      <Toolbar attached>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Attributes
        </h1>
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}
        >
          {attributes.length} rows · flat view
        </span>
        <Toolbar.Spacer />
        {allColumns.length > 0 && (
          <ColumnChooser
            columns={chooserColumns}
            visible={visibleColumns}
            onChange={setVisibleColumns}
            label={`Metadata (${activeMetaCols.length})`}
          />
        )}
      </Toolbar>

      {loading ? (
        <div
          className="flex justify-center items-center"
          style={{
            padding: 40,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderTop: 0,
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          }}
        >
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderTop: 0,
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="warning" size={14} /> {error}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderTop: 0,
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          }}
        >
          <table className="table table-sm w-full" style={{ fontSize: 'var(--fs-md)' }}>
            <thead>
              <tr>
                <GroupHeader colSpan={6} label="Standard" />
                {activeMetaCols.length > 0 && (
                  <GroupHeader colSpan={activeMetaCols.length} label="Governance metadata" meta />
                )}
              </tr>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Description</Th>
                <Th align="center">Required</Th>
                <Th>Entity</Th>
                <Th>Package</Th>
                {activeMetaCols.map((col, i) => (
                  <Th key={col.name} meta first={i === 0} title={col.description}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}
                      <span
                        className="mono"
                        style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', fontWeight: 400 }}
                      >
                        {col.stereotypeName}
                      </span>
                    </span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attributes.length === 0 ? (
                <tr>
                  <td
                    colSpan={6 + activeMetaCols.length}
                    style={{ textAlign: 'center', padding: '28px 10px', color: 'var(--text-subtle)' }}
                  >
                    No attributes found.
                  </td>
                </tr>
              ) : (
                attributes.map(({ attribute, entityName, entityUuid, packageName }) => (
                  <tr key={attribute.uuid + entityName + packageName}>
                    <EditableCell
                      className="mono"
                      value={attribute.name}
                      onSave={async (v) => {
                        await saveAttribute(packageName, entityName, entityUuid, attribute.uuid, (a) => ({
                          ...a,
                          name: v as string,
                        }));
                      }}
                    />
                    <EditableCell
                      value={attribute.type}
                      inputType="select"
                      options={ATTRIBUTE_TYPE_OPTIONS}
                      onSave={async (v) => {
                        await saveAttribute(packageName, entityName, entityUuid, attribute.uuid, (a) => ({
                          ...a,
                          type: v as AttributeType,
                        }));
                      }}
                      renderDisplay={(v) => <TypeChip type={v as string} />}
                    />
                    <EditableCell
                      value={attribute.description || ''}
                      inputType="textarea"
                      renderDisplay={(v) => (
                        <span
                          style={{
                            color: v ? 'var(--text-muted)' : 'var(--text-subtle)',
                            fontStyle: v ? 'normal' : 'italic',
                          }}
                        >
                          {(v as string) || 'no description'}
                        </span>
                      )}
                      onSave={async (v) => {
                        await saveAttribute(packageName, entityName, entityUuid, attribute.uuid, (a) => ({
                          ...a,
                          description: v as string,
                        }));
                      }}
                    />
                    <EditableCell
                      value={attribute.required}
                      inputType="toggle"
                      ariaLabel={`${attribute.name} required`}
                      onSave={async (v) => {
                        await saveAttribute(packageName, entityName, entityUuid, attribute.uuid, (a) => ({
                          ...a,
                          required: v as boolean,
                        }));
                      }}
                    />
                    <td style={{ color: 'var(--text-muted)' }}>{entityName}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{packageName}</td>
                    {activeMetaCols.map((col, i) => {
                      const metaInputType = getMetaInputType(col);
                      const metaVal = getMetadataValue(attribute, col.name);
                      return (
                        <EditableCell
                          key={col.name}
                          className={metaCellClass(i === 0)}
                          value={metaVal ?? (metaInputType === 'toggle' ? false : '')}
                          inputType={metaInputType}
                          renderDisplay={() => renderMetaDisplay(attribute, col)}
                          onSave={async (v) => {
                            await saveAttribute(packageName, entityName, entityUuid, attribute.uuid, (a) => ({
                              ...a,
                              metadata: setMetadataValue(a.metadata, col.name, v),
                            }));
                          }}
                        />
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <style>{`
            /* Meta-tinted cells + dashed boundary between Standard and Governance */
            td.sdd-meta, th.sdd-meta { background: var(--meta-bg); }
            td.sdd-meta-first, th.sdd-meta-first { border-left: 1px dashed var(--meta-border) !important; }
          `}</style>
        </div>
      )}
    </div>
  );
};

// ──────────────── Header helpers ────────────────

interface ThProps {
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  meta?: boolean;
  first?: boolean;
  title?: string;
}

const Th = ({ children, align = 'left', meta, first, title }: ThProps) => (
  <th
    title={title}
    className={meta ? (first ? 'sdd-meta sdd-meta-first' : 'sdd-meta') : undefined}
    style={{
      padding: '6px 10px',
      fontSize: 'var(--fs-sm)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      fontWeight: 600,
      color: meta ? 'var(--meta-label)' : 'var(--text-muted)',
      background: meta ? 'var(--meta-bg)' : 'var(--bg-subtle)',
      borderBottom: '1px solid var(--border-strong)',
      textAlign: align,
    }}
  >
    {children}
  </th>
);

interface GroupHeaderProps {
  colSpan: number;
  label: string;
  meta?: boolean;
}

const GroupHeader = ({ colSpan, label, meta }: GroupHeaderProps) => (
  <th
    colSpan={colSpan}
    className={meta ? 'sdd-meta' : undefined}
    style={{
      padding: '4px 10px',
      fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontWeight: 600,
      color: meta ? 'var(--meta-label)' : 'var(--text-subtle)',
      background: meta ? 'var(--meta-bg)' : 'var(--bg-subtle)',
      borderBottom: '1px solid var(--border)',
      borderLeft: meta ? '1px dashed var(--meta-border)' : undefined,
      textAlign: 'left',
    }}
  >
    {label}
  </th>
);

function metaCellClass(first: boolean): string {
  return first ? 'sdd-meta sdd-meta-first' : 'sdd-meta';
}

// Unused but kept in case future variants need per-cell inline overrides.
void (null as unknown as CSSProperties);

export default AttributeFlatTable;
