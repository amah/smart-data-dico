import { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { ruleApi } from '../services/api';
import type { Rule, RuleScope, RuleSeverityValue, RuleEnforcement } from '../types';
import RuleEditor from '../components/RuleEditor';
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Toolbar,
} from '../components/ui';
import type { ColumnDef } from '../components/ui';

/**
 * Rule browser page (#74).
 *
 * Phase-6 rewrite: Toolbar + DataTable + EmptyState, matching the
 * pattern established on the four flat-data surfaces.
 */

const SEVERITY_TONE: Record<RuleSeverityValue, 'danger' | 'warning' | 'info' | 'neutral'> = {
  error:   'danger',
  warning: 'warning',
  info:    'info',
};

const ENFORCEMENT_TONE: Record<RuleEnforcement, 'danger' | 'warning' | 'neutral'> = {
  save:     'danger',
  process:  'warning',
  advisory: 'neutral',
};

const SCOPE_TONE: Record<RuleScope, 'accent' | 'meta' | 'warning' | 'neutral'> = {
  entity:       'accent',
  package:      'meta',
  perspective:  'accent',
  global:       'warning',
};

const RuleBrowserPage = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<RuleScope | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<RuleSeverityValue | 'all'>('all');
  const [enforcementFilter, setEnforcementFilter] = useState<RuleEnforcement | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editorRule, setEditorRule] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ruleApi.list({
        scope: scopeFilter === 'all' ? undefined : scopeFilter,
        severity: severityFilter === 'all' ? undefined : severityFilter,
        enforcement: enforcementFilter === 'all' ? undefined : enforcementFilter,
      });
      setRules(data);
    } catch {
      setError('Failed to load rules. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, severityFilter, enforcementFilter]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const filteredRules = useMemo(() => {
    if (!search) return rules;
    const s = search.toLowerCase();
    return rules.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.description.toLowerCase().includes(s) ||
      (r.tags || []).some(t => t.toLowerCase().includes(s)),
    );
  }, [rules, search]);

  const columns: ColumnDef<Rule>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Name',
      group: 'standard',
      mono: true,
      sortable: true,
      filterable: true,
      width: 'minmax(180px, 1.2fr)',
      accessor: (r) => r.name,
    },
    {
      key: 'severity',
      header: 'Severity',
      group: 'standard',
      sortable: true,
      width: 100,
      accessor: (r) => r.severity,
      render: (r) => <Chip tone={SEVERITY_TONE[r.severity] ?? 'neutral'} soft>{r.severity}</Chip>,
    },
    {
      key: 'enforcement',
      header: 'Enforcement',
      group: 'standard',
      sortable: true,
      width: 120,
      accessor: (r) => r.enforcement,
      render: (r) => <Chip tone={ENFORCEMENT_TONE[r.enforcement] ?? 'neutral'} soft>{r.enforcement}</Chip>,
    },
    {
      key: 'scope',
      header: 'Scope',
      group: 'standard',
      sortable: true,
      width: 'minmax(130px, auto)',
      accessor: (r) => r.scope,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Chip tone={SCOPE_TONE[r.scope] ?? 'neutral'} soft>{r.scope}</Chip>
          {r.scope === 'global' &&
            [...new Set(r.targets.map(t => t.packageName).filter(Boolean))].map(pkg => (
              <Chip key={pkg} tone="neutral" soft>{pkg}</Chip>
            ))}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      group: 'standard',
      filterable: true,
      width: 'minmax(280px, 2fr)',
      accessor: (r) => r.description,
      render: (r) => (
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <Markdown>{r.description.split('\n')[0] || ''}</Markdown>
        </div>
      ),
    },
    {
      key: 'targets',
      header: 'Targets',
      group: 'standard',
      sortable: true,
      width: 90,
      align: 'center',
      accessor: (r) => r.targets.length,
      render: (r) => <Chip tone="neutral" soft>{r.targets.length}</Chip>,
    },
    {
      key: 'tags',
      header: 'Tags',
      group: 'standard',
      width: 'minmax(120px, 1fr)',
      accessor: (r) => (r.tags || []).join(','),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {(r.tags || []).slice(0, 3).map(tag => (
            <Chip key={tag} tone="neutral">{tag}</Chip>
          ))}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      group: 'standard',
      sortable: true,
      width: 110,
      accessor: (r) => r.updatedAt ?? '',
      render: (r) => r.updatedAt
        ? <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {new Date(r.updatedAt).toLocaleDateString()}
          </span>
        : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
    },
  ], []);

  const handleSaved = () => {
    setEditorRule(null);
    setCreating(false);
    fetchRules();
  };

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
          Validation Rules
        </h1>
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}
        >
          {filteredRules.length} of {rules.length}
        </span>
        <Toolbar.Spacer />
        <Input
          icon="search"
          size="sm"
          placeholder="Search rules…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          width={220}
        />
        <FilterSelect<RuleScope | 'all'>
          value={scopeFilter}
          onChange={setScopeFilter}
          options={[
            { value: 'all', label: 'all scopes' },
            { value: 'entity', label: 'entity' },
            { value: 'package', label: 'package' },
            { value: 'perspective', label: 'perspective' },
            { value: 'global', label: 'global' },
          ]}
          label="Scope"
        />
        <FilterSelect<RuleSeverityValue | 'all'>
          value={severityFilter}
          onChange={setSeverityFilter}
          options={[
            { value: 'all', label: 'all severities' },
            { value: 'error', label: 'error' },
            { value: 'warning', label: 'warning' },
            { value: 'info', label: 'info' },
          ]}
          label="Severity"
        />
        <FilterSelect<RuleEnforcement | 'all'>
          value={enforcementFilter}
          onChange={setEnforcementFilter}
          options={[
            { value: 'all', label: 'all enforcements' },
            { value: 'save', label: 'save' },
            { value: 'process', label: 'process' },
            { value: 'advisory', label: 'advisory' },
          ]}
          label="Enforcement"
        />
        <Button
          size="md"
          variant="primary"
          icon="plus"
          onClick={() => setCreating(true)}
        >
          New Rule
        </Button>
      </Toolbar>

      {loading ? (
        <EmptyState kind="loading" attached message="Loading rules…" />
      ) : error ? (
        <EmptyState
          kind="error"
          attached
          title="Failed to load rules"
          message={error}
          action={{ label: 'Retry', icon: 'sparkle', onClick: fetchRules }}
        />
      ) : (
        <DataTable<Rule>
          columns={columns}
          rows={filteredRules}
          getRowKey={(r) => r.uuid}
          onRowClick={(r) => setEditorRule(r)}
          attached
          emptyMessage={
            <EmptyState
              inline
              kind="empty"
              title="No rules found"
              message={
                search || scopeFilter !== 'all' || severityFilter !== 'all' || enforcementFilter !== 'all'
                  ? 'No rules match the current filters.'
                  : 'No rules yet. Click "New Rule" to add one.'
              }
            />
          }
        />
      )}

      {(editorRule || creating) && (
        <RuleEditor
          rule={editorRule}
          onClose={() => {
            setEditorRule(null);
            setCreating(false);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

// ──────────────── Filter select ────────────────

interface FilterSelectProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}

function FilterSelect<T extends string>({ value, onChange, options, label }: FilterSelectProps<T>) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-muted)',
      }}
    >
      <Icon name="filter" size={12} />
      <select
        value={value}
        aria-label={`Filter by ${label.toLowerCase()}`}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          height: 28,
          padding: '0 6px',
          fontSize: 'var(--fs-sm)',
          fontFamily: 'inherit',
          background: 'var(--bg-raised)',
          color: 'var(--text)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export default RuleBrowserPage;
