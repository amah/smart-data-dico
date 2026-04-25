/**
 * Living style guide — every design-token + every ui/* primitive in one
 * scrollable page so the system stays self-documenting. Replaces the
 * earlier pair of /design/tokens + /design/primitives pages.
 *
 * Editing rule: when you add a new primitive to ui/, drop a section in
 * here. When tokens.css changes, the swatch grid below is the canonical
 * eyeball check. The tonal-pair toggle at the top switches between Calm
 * and Bold so both variants get verified in one place.
 *
 * Visit /design-system.
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
  TreeTable,
  ColumnChooser,
  Modal,
  BatchActionBar,
  EmptyState,
  Menu,
  Field,
  MetadataField,
  fieldStyle,
  type ColumnDef,
  type TreeTableRow,
} from '../components/ui';
import { usePrefs } from '../hooks/usePrefs';

// ──────────────── Token catalog ────────────────

const PALETTE: Array<{ group: string; tokens: Array<{ name: string; cssVar: string }> }> = [
  { group: 'Surface', tokens: [
    { name: 'bg',          cssVar: '--bg' },
    { name: 'bg-raised',   cssVar: '--bg-raised' },
    { name: 'bg-subtle',   cssVar: '--bg-subtle' },
    { name: 'bg-hover',    cssVar: '--bg-hover' },
    { name: 'bg-active',   cssVar: '--bg-active' },
  ]},
  { group: 'Border', tokens: [
    { name: 'border',        cssVar: '--border' },
    { name: 'border-strong', cssVar: '--border-strong' },
    { name: 'border-focus',  cssVar: '--border-focus' },
  ]},
  { group: 'Text', tokens: [
    { name: 'text',        cssVar: '--text' },
    { name: 'text-muted',  cssVar: '--text-muted' },
    { name: 'text-subtle', cssVar: '--text-subtle' },
  ]},
  { group: 'Accent', tokens: [
    { name: 'accent',      cssVar: '--accent' },
    { name: 'accent-fg',   cssVar: '--accent-fg' },
    { name: 'accent-soft', cssVar: '--accent-soft' },
  ]},
  { group: 'Governance metadata', tokens: [
    { name: 'meta-bg',     cssVar: '--meta-bg' },
    { name: 'meta-border', cssVar: '--meta-border' },
    { name: 'meta-label',  cssVar: '--meta-label' },
  ]},
  { group: 'Status', tokens: [
    { name: 'success', cssVar: '--success' },
    { name: 'warning', cssVar: '--warning' },
    { name: 'danger',  cssVar: '--danger' },
  ]},
  { group: 'PII', tokens: [
    { name: 'pii-direct',   cssVar: '--pii-direct' },
    { name: 'pii-indirect', cssVar: '--pii-indirect' },
    { name: 'pii-possible', cssVar: '--pii-possible' },
  ]},
];

// ──────────────── DataTable demo data ────────────────

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
  { key: 'id',         name: 'id',         type: 'uuid',     required: true,  description: 'Primary key',                                owner: 'platform', pii: 'direct',   retention: '7y', encrypted: true,  status: 'pass' },
  { key: 'customerId', name: 'customerId', type: 'uuid',     required: true,  description: 'FK → Customer.id',                           owner: 'billing',  pii: 'direct',   retention: '7y', encrypted: true,  status: 'pass' },
  { key: 'email',      name: 'email',      type: 'email',    required: true,  description: 'Contact email, RFC 5322 validated.',         owner: 'growth',   pii: 'indirect', retention: '2y', encrypted: true,  status: 'drift' },
  { key: 'nickname',   name: 'nickname',   type: 'string',   required: false, description: 'Optional display name.',                     owner: 'growth',   pii: null,       retention: '1y', encrypted: false, status: 'pass' },
  { key: 'region',     name: 'region',     type: 'enum',     required: true,  description: 'Billing region bucket.',                     owner: 'billing',  pii: null,       retention: '7y', encrypted: false, status: 'fail' },
  { key: 'total',      name: 'total',      type: 'decimal',  required: true,  description: 'Order total in minor units.',                owner: 'billing',  pii: null,       retention: '7y', encrypted: false, status: 'pass' },
];

const ATTR_COLUMNS: ColumnDef<AttrRow>[] = [
  { key: 'name',        header: 'Name',        group: 'standard', mono: true, sortable: true, filterable: true, width: 'minmax(160px, 1.4fr)' },
  { key: 'type',        header: 'Type',        group: 'standard', sortable: true, filterable: true, width: 130, render: r => <TypeChip type={r.type} /> },
  { key: 'required',    header: 'Required',    group: 'standard', sortable: true, width: 90, render: r => (r.required ? <Chip tone="accent" soft>yes</Chip> : <span style={{ color: 'var(--text-subtle)' }}>—</span>) },
  { key: 'description', header: 'Description', group: 'standard', filterable: true },

  { key: 'owner',     header: 'Owner',     group: 'metadata', sortable: true, filterable: true, width: 110 },
  { key: 'pii',       header: 'PII',       group: 'metadata', sortable: true, width: 110, render: r => <PiiChip value={r.pii} /> },
  { key: 'retention', header: 'Retention', group: 'metadata', width: 90, align: 'right', mono: true },
  { key: 'encrypted', header: 'Encrypted', group: 'metadata', width: 100, render: r => (r.encrypted ? <Chip tone="success" soft>yes</Chip> : <Chip tone="neutral">no</Chip>) },
  { key: 'status',    header: 'Status',    group: 'metadata', sortable: true, width: 100, render: r => <StatusChip value={r.status} /> },
];

// ──────────────── TreeTable demo data ────────────────

interface DemoTreeNode {
  path: string;
  label: string;
  kind: 'pkg' | 'entity' | 'attr';
  type?: string;
  children?: DemoTreeNode[];
}

const DEMO_TREE: DemoTreeNode[] = [
  {
    path: 'order-service',
    label: 'order-service',
    kind: 'pkg',
    children: [
      { path: 'order-service/Order', label: 'Order', kind: 'entity', children: [
        { path: 'order-service/Order#id', label: 'id', kind: 'attr', type: 'uuid' },
        { path: 'order-service/Order#total', label: 'total', kind: 'attr', type: 'decimal' },
      ]},
      { path: 'order-service/OrderItem', label: 'OrderItem', kind: 'entity', children: [
        { path: 'order-service/OrderItem#sku', label: 'sku', kind: 'attr', type: 'string' },
        { path: 'order-service/OrderItem#qty', label: 'quantity', kind: 'attr', type: 'integer' },
      ]},
    ],
  },
];

// ──────────────── Layout helpers ────────────────

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 32 }}>
    <h2
      className="uppercase"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-subtle)',
        letterSpacing: '0.06em',
        fontWeight: 600,
        marginBottom: hint ? 4 : 12,
      }}
    >
      {title}
    </h2>
    {hint && (
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 12px' }}>
        {hint}
      </p>
    )}
    {children}
  </section>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 0',
      borderTop: '1px dashed var(--border)',
    }}
  >
    <div
      className="mono"
      style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', minWidth: 130, flexShrink: 0 }}
    >
      {label}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
  </div>
);

const Surface = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div
    style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: 14,
      ...style,
    }}
  >
    {children}
  </div>
);

// ──────────────── Variant toggle ────────────────

type Variant = 'calm' | 'bold';

const VariantToggle = ({ variant, onChange }: { variant: Variant; onChange: (v: Variant) => void }) => (
  <div style={{ display: 'inline-flex', gap: 4 }}>
    <Button size="sm" variant={variant === 'calm' ? 'primary' : 'ghost'} onClick={() => onChange('calm')}>
      Calm
    </Button>
    <Button size="sm" variant={variant === 'bold' ? 'primary' : 'ghost'} onClick={() => onChange('bold')}>
      Bold
    </Button>
  </div>
);

// ──────────────── Page ────────────────

const DesignSystemPage = () => {
  const { density, setDensity } = usePrefs();
  // Variant is scoped to this page's subtree via data-variant on the
  // wrapper div — the shell plugin owns the global variant on <html>, so
  // mutating that here would just race with its watcher. Token rules in
  // tokens.css match any element carrying data-variant, so the scoped
  // attribute cascades through all primitives below.
  const [variant, setVariant] = useState<Variant>(() => {
    return (document.documentElement.getAttribute('data-variant') as Variant) || 'calm';
  });

  // DataTable demo
  const [visibleCols, setVisibleCols] = useState(new Set(ATTR_COLUMNS.map(c => c.key)));
  const [selectedKey, setSelectedKey] = useState<string | number | null>('email');
  const [showFilterRow, setShowFilterRow] = useState(false);
  const [tableSelection, setTableSelection] = useState<Set<string | number>>(new Set());

  // Modal demo
  const [modalOpen, setModalOpen] = useState(false);

  // BatchActionBar demo (this primitive is fixed-position, so we render
  // it with a count > 0 only while the demo is "armed").
  const [bulkArmed, setBulkArmed] = useState(false);

  // TreeTable demo: caller-owned expansion state
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['order-service']));
  const toggleExpanded = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const treeRows: TreeTableRow<DemoTreeNode>[] = [];
  const walk = (items: DemoTreeNode[], indent: number) => {
    for (const item of items) {
      const hasChildren = !!item.children && item.children.length > 0;
      const isExpanded = expanded.has(item.path);
      treeRows.push({
        row: item,
        indent,
        hasChildren,
        isExpanded,
        toggle: () => toggleExpanded(item.path),
      });
      if (hasChildren && isExpanded) walk(item.children!, indent + 1);
    }
  };
  walk(DEMO_TREE, 0);

  const treeColumns: ColumnDef<DemoTreeNode>[] = [
    { key: 'label', header: 'Name', group: 'standard', width: 280, render: n => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className={n.kind === 'attr' ? 'mono' : ''} style={{ fontSize: 'var(--fs-sm)' }}>
          {n.label}
        </span>
        {n.kind === 'pkg' && <Chip tone="meta">package</Chip>}
        {n.kind === 'entity' && <Chip tone="accent" soft>entity</Chip>}
      </span>
    )},
    { key: 'kind', header: 'Kind', group: 'standard', width: 100, render: n => (
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{n.kind}</span>
    )},
    { key: 'type', header: 'Type', group: 'metadata', width: 120, render: n => n.type ? <TypeChip type={n.type} /> : <span style={{ color: 'var(--text-subtle)' }}>—</span> },
  ];

  return (
    <div
      data-variant={variant}
      style={{
        padding: 24,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-sans)',
        minHeight: '100vh',
      }}
    >
      <header style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="mono" style={{ fontSize: 'var(--fs-3xl)', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            design system
          </h1>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Living reference. Tokens, primitives, and the patterns that hold them together.
          </p>
        </div>
        <VariantToggle variant={variant} onChange={setVariant} />
      </header>

      {/* ──────────────── Patterns ──────────────── */}

      <Section title="Patterns" hint="Three rules that don't show up by reading the primitives.">
        <Surface>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--text)' }}>
            <li>
              <strong>Primitives over Tailwind/DaisyUI.</strong> New components consume{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>frontend/src/components/ui/</code>. Reach for{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>btn-*</code> or{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>bg-base-100</code> only when migrating legacy code.
            </li>
            <li>
              <strong>Tokens, not hex.</strong> Inline styles use{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>var(--bg-raised)</code>, not{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>#ffffff</code>. Variants and themes live in{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>tokens.css</code> — the rest of the codebase
              just references them.
            </li>
            <li>
              <strong>Sticky header on full-page tables, off in tab-embedded ones.</strong>{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>EntityFlatTable</code> /{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>AttributeFlatTable</code> /{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>PackageFlatTable</code> /{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>RuleBrowserPage</code> set{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>stickyHeader</code>;{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>AttributeList</code> /{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>RelationshipList</code> don't because they live
              inside an EntityDetail tab and would compete with the page scroll.
            </li>
          </ol>
        </Surface>
      </Section>

      {/* ──────────────── Tokens ──────────────── */}

      <Section title="Palette" hint="Toggle Calm/Bold above and theme from the top bar to verify all four combinations.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {PALETTE.flatMap(g => g.tokens).map(t => (
            <Swatch key={t.cssVar} {...t} />
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <Surface>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>The quick brown fox — 3xl / 28px</div>
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600 }}>The quick brown fox — 2xl / 20px</div>
          <div style={{ fontSize: 'var(--fs-xl)' }}>The quick brown fox — xl / 16px</div>
          <div style={{ fontSize: 'var(--fs-lg)' }}>The quick brown fox — lg / 14px</div>
          <div style={{ fontSize: 'var(--fs-md)' }}>The quick brown fox — md / 13px (body)</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>The quick brown fox — sm / 12px</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>The quick brown fox — xs / 11px</div>
          <div className="mono" style={{ fontSize: 'var(--fs-md)', marginTop: 8 }}>
            Mono 0123456789 — slashed zero · Order.lineItems[].quantity · uuid
          </div>
        </Surface>
      </Section>

      <Section title="Standard vs Governance metadata grammar" hint="The dashed left border + tinted background marks the metadata side throughout the app.">
        <Surface style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <GroupCellHeader>Standard</GroupCellHeader>
            <GroupCellHeader meta>Governance metadata</GroupCellHeader>
            <div style={{ padding: '12px' }}>
              <div className="mono" style={{ fontSize: 'var(--fs-sm)' }}>customerId</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>uuid · required</div>
            </div>
            <div style={{ padding: 12, background: 'var(--meta-bg)', borderLeft: '1px dashed var(--meta-border)' }}>
              <PiiChip value="direct" /> · 7y retention
            </div>
          </div>
        </Surface>
      </Section>

      {/* ──────────────── Chips ──────────────── */}

      <Section title="Chip — base tones">
        <Surface>
          <Row label="solid">
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
        </Surface>
      </Section>

      <Section title="TypeChip">
        <Surface>
          <Row label="primitive">
            <TypeChip type="string" /><TypeChip type="number" /><TypeChip type="integer" />
            <TypeChip type="decimal" /><TypeChip type="boolean" /><TypeChip type="date" />
            <TypeChip type="datetime" /><TypeChip type="uuid" />
          </Row>
          <Row label="semantic"><TypeChip type="enum" /><TypeChip type="ref" /><TypeChip type="object" /><TypeChip type="array" /></Row>
          <Row label="derived"><TypeChip type="email" /><TypeChip type="url" /><TypeChip type="iso-4217" /></Row>
        </Surface>
      </Section>

      <Section title="PiiChip">
        <Surface>
          <Row label="states">
            <PiiChip value="direct" />
            <PiiChip value="indirect" />
            <PiiChip value="possible" />
            <PiiChip value={null} />
          </Row>
        </Surface>
      </Section>

      <Section title="StatusChip">
        <Surface>
          <Row label="integrity"><StatusChip value="pass" /><StatusChip value="fail" /><StatusChip value="drift" /></Row>
          <Row label="severity"><StatusChip value="blocker" /><StatusChip value="error" /><StatusChip value="warning" /><StatusChip value="info" /></Row>
          <Row label="diff"><StatusChip value="breaking" /><StatusChip value="major" /><StatusChip value="minor" /><StatusChip value="info" /></Row>
          <Row label="outlined"><StatusChip value="pass" outlined /><StatusChip value="fail" outlined /><StatusChip value="breaking" outlined /></Row>
        </Surface>
      </Section>

      <Section title="KindChip — categories + relationships">
        <Surface>
          <Row label="V/C/R full"><CategoryKindChip kind="validation" /><CategoryKindChip kind="constraint" /><CategoryKindChip kind="rule" /></Row>
          <Row label="V/C/R initial"><CategoryKindChip kind="validation" initialOnly /><CategoryKindChip kind="constraint" initialOnly /><CategoryKindChip kind="rule" initialOnly /></Row>
          <Row label="relationship"><RelationshipKindChip kind="embedded" /><RelationshipKindChip kind="reference" /></Row>
        </Surface>
      </Section>

      {/* ──────────────── Form / control ──────────────── */}

      <Section title="Button — variants × sizes">
        <Surface>
          <Row label="primary"><Button variant="primary" size="sm">Save</Button><Button variant="primary" size="md">Save</Button><Button variant="primary" size="lg" icon="plus">Add</Button></Row>
          <Row label="secondary"><Button size="sm">Cancel</Button><Button size="md" icon="edit">Edit</Button><Button size="lg" icon="copy">Duplicate</Button></Row>
          <Row label="ghost"><Button variant="ghost" size="md" icon="columns">Columns</Button><Button variant="ghost" size="md" icon="filter">Filter</Button><Button variant="ghost" size="md" icon="sort">Sort</Button></Row>
          <Row label="soft / danger"><Button variant="soft" size="md">Soft</Button><Button variant="danger" size="md" icon="close">Delete</Button></Row>
          <Row label="icon-only"><Button variant="ghost" size="md" icon="moreV" iconOnly aria-label="More" /><Button variant="ghost" size="md" icon="close" iconOnly aria-label="Close" /></Row>
          <Row label="state"><Button size="md" disabled>Disabled</Button><Button size="md" pressed icon="eye">Pressed</Button></Row>
        </Surface>
      </Section>

      <Section title="Input">
        <Surface>
          <Row label="sizes"><Input size="sm" placeholder="small" /><Input size="md" placeholder="medium" /></Row>
          <Row label="with icon"><Input size="md" icon="search" placeholder="Search…" width={220} /><Input size="sm" icon="filter" placeholder="filter…" width={180} /></Row>
        </Surface>
      </Section>

      <Section title="Field / fieldStyle — form-row primitives" hint="Field labels controls; fieldStyle is the shared input style for hand-rolled controls.">
        <Surface>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 600 }}>
            <Field label="Email">
              <input type="email" placeholder="user@example.com" style={fieldStyle} />
            </Field>
            <Field label="Tier">
              <select style={fieldStyle}>
                <option>Standard</option>
                <option>Pro</option>
              </select>
            </Field>
            <Field label="Active" inline>
              <input type="checkbox" defaultChecked />
            </Field>
            <MetadataField
              column={{
                name: 'demo-flag',
                label: 'Demo flag',
                type: 'flag',
                required: false,
                stereotypeId: 'demo',
                stereotypeName: 'Governance',
              }}
              value={true}
              onChange={() => {}}
            />
          </div>
        </Surface>
      </Section>

      <Section title="DensitySwitcher">
        <Surface>
          <Row label={`active: ${density}`}>
            <DensitySwitcher value={density} onChange={setDensity} />
          </Row>
        </Surface>
      </Section>

      {/* ──────────────── Composition ──────────────── */}

      <Section title="Toolbar">
        <Toolbar>
          <Button variant="primary" size="md" icon="plus">Add</Button>
          <Button variant="ghost" size="md" icon="columns">Columns</Button>
          <Button variant="ghost" size="md" icon="filter">Filter</Button>
          <Toolbar.Spacer />
          <Input size="sm" icon="search" placeholder="Search…" width={200} />
          <Toolbar.Divider />
          <DensitySwitcher value={density} onChange={setDensity} />
        </Toolbar>
      </Section>

      <Section title="Menu — popover with click-outside">
        <Surface>
          <Menu
            trigger={({ open, toggle }) => (
              <Button size="md" variant="secondary" icon="moreV" pressed={open} onClick={toggle}>
                Menu
              </Button>
            )}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {['Edit', 'Duplicate', 'Archive'].map(label => (
                <button key={label} type="button" style={menuItemStyle}>{label}</button>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <button type="button" style={{ ...menuItemStyle, color: 'var(--danger)' }}>Delete</button>
            </div>
          </Menu>
        </Surface>
      </Section>

      <Section title="EmptyState — loading / error / empty">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <EmptyState kind="loading" message="Loading entities…" />
          <EmptyState kind="error" title="Failed to load" message="Network error" action={{ label: 'Retry', icon: 'sparkle', onClick: () => {} }} />
          <EmptyState kind="empty" title="No results" message="Adjust filters and try again." />
        </div>
      </Section>

      <Section title="Modal">
        <Surface>
          <Button variant="primary" icon="plus" onClick={() => setModalOpen(true)}>Open modal</Button>
        </Surface>
        <Modal open={modalOpen} title="Example modal" onClose={() => setModalOpen(false)}>
          <Field label="Name">
            <input type="text" defaultValue="Order" style={fieldStyle} />
          </Field>
          <Field label="Description">
            <textarea rows={3} style={{ ...fieldStyle, height: 'auto', padding: '6px 8px' }} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="check" onClick={() => setModalOpen(false)}>Save</Button>
          </div>
        </Modal>
      </Section>

      <Section title="BatchActionBar — fixed-position bulk-action surface">
        <Surface>
          <Button
            variant={bulkArmed ? 'primary' : 'secondary'}
            onClick={() => setBulkArmed(v => !v)}
          >
            {bulkArmed ? 'Hide bar' : 'Show bar (3 selected)'}
          </Button>
        </Surface>
        <BatchActionBar
          count={bulkArmed ? 3 : 0}
          onClear={() => setBulkArmed(false)}
          label="row"
          actions={[
            { label: 'Mark required', icon: 'check', onClick: () => {} },
            { label: 'Mark PII', icon: 'shield', onClick: () => {} },
            { label: 'Delete', icon: 'close', tone: 'danger', onClick: () => {} },
          ]}
        />
      </Section>

      {/* ──────────────── Tables ──────────────── */}

      <Section title="DataTable" hint="Standard / governance-metadata split, sticky header, drag-to-resize, multi-select, per-row actions.">
        <div>
          <Toolbar attached>
            <Button variant="primary" size="md" icon="plus">Add attribute</Button>
            <ColumnChooser
              columns={ATTR_COLUMNS as ColumnDef<unknown>[]}
              visible={visibleCols}
              onChange={setVisibleCols}
            />
            <Button variant="ghost" size="md" icon="filter" pressed={showFilterRow} onClick={() => setShowFilterRow(v => !v)}>
              Filter
            </Button>
            <Toolbar.Spacer />
            <Input size="sm" icon="search" placeholder="Search…" width={200} />
          </Toolbar>
          <DataTable<AttrRow>
            attached
            columns={ATTR_COLUMNS}
            rows={ATTR_ROWS}
            getRowKey={r => r.key}
            visibleColumns={visibleCols}
            selectedRow={selectedKey}
            onSelectRow={setSelectedKey}
            selection={tableSelection}
            onSelectionChange={setTableSelection}
            showFilterRow={showFilterRow}
            resizeKey="design-system-demo"
            stickyHeader
            stickyFirstColumn
            rowActions={(r) => (
              <Button size="sm" variant="ghost" icon="close" iconOnly aria-label={`Delete ${r.name}`} />
            )}
          />
        </div>
      </Section>

      <Section title="TreeTable" hint="Same column grammar as DataTable, plus indent + expand chevron on a designated tree column.">
        <TreeTable<DemoTreeNode>
          columns={treeColumns}
          rows={treeRows}
          getRowKey={n => n.path}
          treeColumnKey="label"
          resizeKey="design-system-tree-demo"
          stickyHeader
        />
      </Section>
    </div>
  );
};

// ──────────────── Local helpers ────────────────

const Swatch = ({ name, cssVar }: { name: string; cssVar: string }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: 8,
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 'var(--radius-sm)',
        background: `var(${cssVar})`,
        boxShadow: 'inset 0 0 0 1px var(--border)',
        flexShrink: 0,
      }}
    />
    <div style={{ minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>{cssVar}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{name}</div>
    </div>
  </div>
);

const GroupCellHeader = ({ children, meta }: { children: React.ReactNode; meta?: boolean }) => (
  <div
    className="uppercase"
    style={{
      fontSize: 'var(--fs-xs)',
      fontWeight: 600,
      letterSpacing: '0.06em',
      padding: '8px 12px',
      background: meta ? 'var(--meta-bg)' : 'var(--bg-subtle)',
      color: meta ? 'var(--meta-label)' : 'var(--text-subtle)',
      borderBottom: '1px solid var(--border-strong)',
      borderLeft: meta ? '1px dashed var(--meta-border)' : undefined,
    }}
  >
    {children}
  </div>
);

const menuItemStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

export default DesignSystemPage;
