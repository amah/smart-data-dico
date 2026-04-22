/**
 * Design primitives showcase — renders every Phase 2 component in
 * all states so the wiring can be reviewed visually in light + dark.
 *
 * Grows as Phase 2 lands: chips → Toolbar → DataTable.
 *
 * Visit `/design/primitives`.
 */

import { useState } from 'react';
import {
  Chip,
  TypeChip,
  PiiChip,
  StatusChip,
  CategoryKindChip,
  RelationshipKindChip,
  Button,
  Input,
  DensitySwitcher,
  Toolbar,
  DataTable,
  ColumnChooser,
  type ColumnDef,
} from '../components/ui';
import { usePrefs } from '../hooks/usePrefs';

// ──────────── Demo data for the DataTable sample ────────────

type AttrRow = {
  key: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
  owner: string;
  pii: 'direct' | 'indirect' | 'possible' | null;
  retention: string;
  encrypted: boolean;
  status: 'pass' | 'fail' | 'drift';
};

const ATTR_ROWS: AttrRow[] = [
  { key: 'id',         name: 'id',           type: 'uuid',     required: true,  description: 'Primary key',                                owner: 'platform',  pii: 'direct',   retention: '7y', encrypted: true,  status: 'pass' },
  { key: 'customerId', name: 'customerId',   type: 'uuid',     required: true,  description: 'FK → Customer.id',                           owner: 'billing',   pii: 'direct',   retention: '7y', encrypted: true,  status: 'pass' },
  { key: 'email',      name: 'email',        type: 'email',    required: true,  description: 'Contact email, RFC 5322 validated.',         owner: 'growth',    pii: 'indirect', retention: '2y', encrypted: true,  status: 'drift' },
  { key: 'nickname',   name: 'nickname',     type: 'string',   required: false, description: 'Optional display name.',                     owner: 'growth',    pii: null,       retention: '1y', encrypted: false, status: 'pass' },
  { key: 'region',     name: 'region',       type: 'enum',     required: true,  description: 'Billing region bucket.',                     owner: 'billing',   pii: null,       retention: '7y', encrypted: false, status: 'fail' },
  { key: 'total',      name: 'total',        type: 'decimal',  required: true,  description: 'Order total in minor units.',                owner: 'billing',   pii: null,       retention: '7y', encrypted: false, status: 'pass' },
  { key: 'createdAt',  name: 'createdAt',    type: 'datetime', required: true,  description: 'Row insert timestamp.',                      owner: 'platform',  pii: null,       retention: '7y', encrypted: false, status: 'pass' },
  { key: 'metadata',   name: 'metadata',     type: 'object',   required: false, description: 'Service-specific key/value bag.',            owner: 'platform',  pii: 'possible', retention: '1y', encrypted: false, status: 'info' as 'pass' },
];

const ATTR_COLUMNS: ColumnDef<AttrRow>[] = [
  { key: 'name',        header: 'Name',        group: 'standard', mono: true, sortable: true, filterable: true, width: 'minmax(160px, 1.4fr)' },
  { key: 'type',        header: 'Type',        group: 'standard', sortable: true, filterable: true, width: 130, render: r => <TypeChip type={r.type} /> },
  { key: 'required',    header: 'Required',    group: 'standard', sortable: true, width: 90, render: r => (r.required ? <Chip tone="accent" soft>yes</Chip> : <span style={{ color: 'var(--text-subtle)' }}>—</span>) },
  { key: 'description', header: 'Description', group: 'standard', filterable: true },

  { key: 'owner',     header: 'Owner',    group: 'metadata', sortable: true, filterable: true, width: 110 },
  { key: 'pii',       header: 'PII',      group: 'metadata', sortable: true, width: 110, render: r => <PiiChip value={r.pii} /> },
  { key: 'retention', header: 'Retention', group: 'metadata', width: 90, align: 'right', mono: true },
  { key: 'encrypted', header: 'Encrypted', group: 'metadata', width: 100, render: r => (r.encrypted ? <Chip tone="success" soft>yes</Chip> : <Chip tone="neutral">no</Chip>) },
  { key: 'status',    header: 'Status',   group: 'metadata', sortable: true, width: 100, render: r => <StatusChip value={r.status} /> },
];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2
      className="mb-3 uppercase tracking-wider"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-subtle)',
        letterSpacing: '0.06em',
        fontWeight: 600,
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-3 py-2" style={{ borderTop: '1px dashed var(--border)' }}>
    <div
      className="mono"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-subtle)',
        minWidth: 120,
      }}
    >
      {label}
    </div>
    <div className="flex flex-wrap gap-1.5 items-center">{children}</div>
  </div>
);

const DesignPrimitivesPage = () => {
  const { density, setDensity } = usePrefs();
  const [search, setSearch] = useState('');

  // DataTable demo state
  const [visibleCols, setVisibleCols] = useState(new Set(ATTR_COLUMNS.map(c => c.key)));
  const [selectedKey, setSelectedKey] = useState<string | number | null>('email');
  const [showFilterRow, setShowFilterRow] = useState(false);

  return (
    <div
      className="p-6 min-h-screen"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <header className="mb-6">
        <h1 className="mono" style={{ fontSize: 'var(--fs-3xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
          design / primitives
        </h1>
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', marginTop: 4 }}>
          Phase 2 — ui primitives (#115). Toggle the theme from the top bar to eyeball both states.
        </p>
      </header>

      <Section title="Chip — base tones">
        <Row label="solid (default)">
          <Chip tone="neutral">neutral</Chip>
          <Chip tone="accent">accent</Chip>
          <Chip tone="success">success</Chip>
          <Chip tone="warning">warning</Chip>
          <Chip tone="danger">danger</Chip>
          <Chip tone="info">info</Chip>
          <Chip tone="meta">meta</Chip>
        </Row>
        <Row label="soft fill">
          <Chip tone="accent" soft>accent</Chip>
          <Chip tone="success" soft>success</Chip>
          <Chip tone="warning" soft>warning</Chip>
          <Chip tone="danger" soft>danger</Chip>
          <Chip tone="info" soft>info</Chip>
          <Chip tone="meta" soft>meta</Chip>
        </Row>
        <Row label="mono / dashed">
          <Chip mono>id</Chip>
          <Chip mono tone="accent">enum</Chip>
          <Chip mono dashed>object</Chip>
          <Chip dot tone="danger">with dot</Chip>
        </Row>
      </Section>

      <Section title="TypeChip — attribute types">
        <Row label="primitive">
          <TypeChip type="string" />
          <TypeChip type="number" />
          <TypeChip type="integer" />
          <TypeChip type="decimal" />
          <TypeChip type="boolean" />
          <TypeChip type="date" />
          <TypeChip type="datetime" />
          <TypeChip type="uuid" />
        </Row>
        <Row label="semantic">
          <TypeChip type="enum" />
          <TypeChip type="ref" />
          <TypeChip type="object" />
          <TypeChip type="array" />
        </Row>
        <Row label="derived (unknown)">
          <TypeChip type="email" />
          <TypeChip type="url" />
          <TypeChip type="iso-4217" />
        </Row>
      </Section>

      <Section title="PiiChip">
        <Row label="states">
          <PiiChip value="direct" />
          <PiiChip value="indirect" />
          <PiiChip value="possible" />
          <PiiChip value={null} />
        </Row>
      </Section>

      <Section title="StatusChip — integrity + diff">
        <Row label="integrity status">
          <StatusChip value="pass" />
          <StatusChip value="fail" />
          <StatusChip value="drift" />
        </Row>
        <Row label="severity">
          <StatusChip value="blocker" />
          <StatusChip value="error" />
          <StatusChip value="warning" />
          <StatusChip value="info" />
        </Row>
        <Row label="diff kind">
          <StatusChip value="breaking" />
          <StatusChip value="major" />
          <StatusChip value="minor" />
          <StatusChip value="info" />
        </Row>
        <Row label="outlined">
          <StatusChip value="pass" outlined />
          <StatusChip value="fail" outlined />
          <StatusChip value="drift" outlined />
          <StatusChip value="breaking" outlined />
        </Row>
      </Section>

      <Section title="KindChip — categories + relationships">
        <Row label="V / C / R (full)">
          <CategoryKindChip kind="validation" />
          <CategoryKindChip kind="constraint" />
          <CategoryKindChip kind="rule" />
        </Row>
        <Row label="V / C / R (initial)">
          <CategoryKindChip kind="validation" initialOnly />
          <CategoryKindChip kind="constraint" initialOnly />
          <CategoryKindChip kind="rule" initialOnly />
        </Row>
        <Row label="relationship">
          <RelationshipKindChip kind="embedded" />
          <RelationshipKindChip kind="reference" />
        </Row>
      </Section>

      <Section title="Button — variants × sizes">
        <Row label="primary">
          <Button variant="primary" size="sm">Save</Button>
          <Button variant="primary" size="md">Save</Button>
          <Button variant="primary" size="lg" icon="plus">Add attribute</Button>
        </Row>
        <Row label="secondary">
          <Button size="sm">Cancel</Button>
          <Button size="md" icon="edit">Edit</Button>
          <Button size="lg" icon="copy">Duplicate</Button>
        </Row>
        <Row label="ghost">
          <Button variant="ghost" size="md" icon="columns">Columns…</Button>
          <Button variant="ghost" size="md" icon="filter">Filter</Button>
          <Button variant="ghost" size="md" icon="sort">Sort</Button>
        </Row>
        <Row label="soft / danger">
          <Button variant="soft" size="md">Soft</Button>
          <Button variant="danger" size="md">Delete</Button>
        </Row>
        <Row label="icon-only">
          <Button variant="ghost" size="md" icon="moreV" iconOnly aria-label="More actions" />
          <Button variant="ghost" size="md" icon="close" iconOnly aria-label="Close" />
          <Button variant="secondary" size="md" icon="sun" iconOnly aria-label="Toggle theme" />
        </Row>
        <Row label="disabled / pressed">
          <Button size="md" disabled>Disabled</Button>
          <Button size="md" pressed icon="eye">Pressed</Button>
        </Row>
      </Section>

      <Section title="Input">
        <Row label="sizes">
          <Input size="sm" placeholder="small input" />
          <Input size="md" placeholder="medium input" />
        </Row>
        <Row label="with icon">
          <Input size="md" icon="search" placeholder="Search entities…" width={240} />
          <Input size="sm" icon="filter" placeholder="filter…" width={180} />
        </Row>
      </Section>

      <Section title="DensitySwitcher">
        <Row label={`active: ${density}`}>
          <DensitySwitcher value={density} onChange={setDensity} />
        </Row>
      </Section>

      <Section title="Toolbar — composed">
        <Toolbar>
          <Button variant="primary" size="md" icon="plus">Add attribute</Button>
          <Button variant="ghost" size="md" icon="columns">Columns…</Button>
          <Button variant="ghost" size="md" icon="filter">Filter</Button>
          <Button variant="ghost" size="md" icon="sort">Sort</Button>
          <Toolbar.Spacer />
          <Input
            size="sm"
            icon="search"
            placeholder="Search…"
            width={220}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Toolbar.Divider />
          <DensitySwitcher value={density} onChange={setDensity} />
          <Button variant="ghost" size="md" icon="moreV" iconOnly aria-label="View options" />
        </Toolbar>
      </Section>

      <Section title="DataTable — Standard vs Governance metadata split">
        <div>
          <Toolbar attached>
            <Button variant="primary" size="md" icon="plus">Add attribute</Button>
            <ColumnChooser
              columns={ATTR_COLUMNS as ColumnDef<unknown>[]}
              visible={visibleCols}
              onChange={setVisibleCols}
            />
            <Button
              variant="ghost"
              size="md"
              icon="filter"
              pressed={showFilterRow}
              onClick={() => setShowFilterRow(v => !v)}
            >
              Filter
            </Button>
            <Toolbar.Spacer />
            <Input size="sm" icon="search" placeholder="Search…" width={200} />
            <Toolbar.Divider />
            <DensitySwitcher value={density} onChange={setDensity} />
            <Button variant="ghost" size="md" icon="moreV" iconOnly aria-label="View options" />
          </Toolbar>
          <DataTable<AttrRow>
            attached
            columns={ATTR_COLUMNS}
            rows={ATTR_ROWS}
            getRowKey={r => r.key}
            visibleColumns={visibleCols}
            selectedRow={selectedKey}
            onSelectRow={setSelectedKey}
            showFilterRow={showFilterRow}
          />
        </div>
      </Section>

    </div>
  );
};

export default DesignPrimitivesPage;
