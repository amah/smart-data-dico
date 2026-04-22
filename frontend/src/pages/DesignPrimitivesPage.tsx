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
  type Density,
} from '../components/ui';

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
  const [density, setDensity] = useState<Density>('comfortable');
  const [search, setSearch] = useState('');
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

      <Section title="In-context sample row (Standard vs Governance metadata)">
        <div
          className="rounded-token-md overflow-hidden"
          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: 'minmax(200px, 1.4fr) 120px 80px minmax(0, 1fr) 140px 110px' }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 uppercase col-span-4"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-subtle)',
                letterSpacing: '0.04em',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border-strong)',
                gridColumn: 'span 4 / span 4',
              }}
            >
              Standard
            </div>
            <div
              className="px-3 py-2 uppercase col-span-2"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--meta-label)',
                letterSpacing: '0.04em',
                background: 'var(--meta-bg)',
                borderBottom: '1px solid var(--border-strong)',
                borderLeft: '1px dashed var(--meta-border)',
                gridColumn: 'span 2 / span 2',
              }}
            >
              Governance metadata
            </div>

            {[
              ['customerId',   'uuid',     true,  'Primary key reference to Customer.',           'direct',   'pass'],
              ['email',        'email',    true,  'Contact email, validated against RFC 5322.',   'indirect', 'drift'],
              ['nickname',     'string',   false, 'Optional display name.',                        null,      'pass'],
              ['region',       'enum',     true,  'Billing region bucket.',                        null,      'fail'],
              ['metadata',     'object',   false, 'Service-specific key/value bag.',               'possible','info'],
            ].map(([name, type, req, desc, pii, status], i) => (
              <div key={i} className="contents">
                <div className="px-3 py-3 mono" style={{ fontSize: 'var(--fs-sm)' }}>{name}</div>
                <div className="px-3 py-3"><TypeChip type={type as string} /></div>
                <div className="px-3 py-3" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                  {req ? 'required' : 'optional'}
                </div>
                <div className="px-3 py-3" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
                  {desc as string}
                </div>
                <div
                  className="px-3 py-3"
                  style={{ background: 'var(--meta-bg)', borderLeft: '1px dashed var(--meta-border)' }}
                >
                  <PiiChip value={pii as 'direct' | 'indirect' | 'possible' | null} />
                </div>
                <div
                  className="px-3 py-3"
                  style={{ background: 'var(--meta-bg)' }}
                >
                  <StatusChip value={status as 'pass' | 'fail' | 'drift' | 'info'} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
};

export default DesignPrimitivesPage;
