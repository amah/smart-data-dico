/**
 * Sidebar — 240px nav rail with Browse / Views / Tools grammar
 * (Shell grammar — see /design-system).
 *
 *   Browse — Home + packages tree (entities + cases under each package).
 *   Views  — Quality · Integrity · Model Diff · Physical Sync · Diagram.
 *   Tools  — Flat views · Data Types · Settings.
 *
 * Collapsed mode: icon rail at ~48px for desktop-density screens.
 *
 * Every nav row:
 *   32px tall · 12px horizontal padding · hover --bg-hover
 *   Active  → --accent-soft bg, --accent color, 2px accent left stripe.
 *
 * The section headers are deliberately static labels (not accordion
 * toggles). Accordion-per-section was useful in the old dense layout
 * but muddies the grammar; per-package expand/collapse stays because
 * the tree can get genuinely deep.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { entityApi } from '../services/api';
import type { Package } from '../types';
import { Icon, type IconName } from './ui';

interface SidebarProps {
  collapsed?: boolean;
}

const Sidebar = ({ collapsed = false }: SidebarProps) => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [flatViewsOpen, setFlatViewsOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        setPackagesLoading(true);
        const response = await entityApi.getAllPackages();
        setPackages(response);
        setPackagesError(null);
      } catch (err) {
        console.error('Error fetching packages:', err);
        setPackagesError('Failed to load packages');
      } finally {
        setPackagesLoading(false);
      }
    };
    fetchPackages();
  }, []);

  // Standard "inside this section" match — used for View/Tools rows where the
  // section's subroutes should keep the header highlighted (e.g. `/quality/x`
  // still highlights the Quality row).
  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  // Exact match — used for the package tree so a parent package doesn't stay
  // highlighted when you're on one of its entities. Only one row in the tree
  // should read as "selected" at a time (handoff §Shell).
  const isActiveExact = (path: string) => location.pathname === path;

  const togglePackage = (pkgId: string) =>
    setExpandedPackages(prev => ({ ...prev, [pkgId]: !prev[pkgId] }));

  // ────────── Collapsed mode (mobile / icon rail) ──────────
  if (collapsed) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 0',
          gap: 4,
        }}
      >
        <CollapsedLink to="/"            icon="home"    label="Home"        active={location.pathname === '/'} />
        <CollapsedLink to="/quality"     icon="shield"  label="Quality"     active={isActive('/quality')} />
        <CollapsedLink to="/integrity"   icon="check"   label="Integrity"   active={isActive('/integrity')} />
        <CollapsedLink to="/diff/logical" icon="link"    label="Model Diff" active={isActive('/diff/logical') || isActive('/diff/physical')} />
        <CollapsedLink to="/diagram"     icon="chart"   label="Diagram"     active={isActive('/diagram')} />
        <CollapsedLink to="/types"       icon="rows"    label="Data Types"  active={isActive('/types')} />
        <CollapsedLink to="/settings"    icon="gear"    label="Settings"    active={isActive('/settings')} />
      </div>
    );
  }

  // ────────── Expanded mode ──────────
  return (
    <aside
      className="sdd-sidebar"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '6px 6px 12px',
        overflowY: 'auto',
        color: 'var(--text)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      {/* Scope the :focus-visible ring inside sidebar rows so the outline
          doesn't wrap the whole row on top of the active accent-soft bg. */}
      <style>{`
        .sdd-sidebar a:focus-visible,
        .sdd-sidebar button:focus-visible {
          outline-offset: -2px;
        }
      `}</style>
      {/* Browse */}
      <NavItem to="/" icon="home" active={location.pathname === '/'}>
        Home
      </NavItem>

      <SectionLabel>Browse</SectionLabel>

      {packagesLoading ? (
        <div style={{ padding: '6px 10px', color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)' }}>
          Loading…
        </div>
      ) : packagesError ? (
        <div style={{ padding: '6px 10px', color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>
          {packagesError}
        </div>
      ) : packages.length === 0 ? (
        <div style={{ padding: '6px 10px', color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)' }}>
          No packages
        </div>
      ) : (
        renderPackageTree(packages, [], expandedPackages, togglePackage, isActiveExact)
      )}

      {/* Views */}
      <SectionLabel>Views</SectionLabel>

      <NavItem to="/quality"      icon="shield"  active={isActive('/quality')}>Quality</NavItem>
      <NavItem to="/integrity"    icon="check"   active={isActive('/integrity')}>Integrity</NavItem>
      <NavItem to="/diff/logical" icon="link"    active={isActive('/diff/logical')}>Model Diff</NavItem>
      <NavItem to="/diff/physical" icon="layers" active={isActive('/diff/physical')}>Physical Sync</NavItem>
      <NavItem to="/diagram"      icon="chart"   active={isActive('/diagram')}>Diagram</NavItem>
      <NavItem
        icon="rows"
        onClick={() => setFlatViewsOpen(v => !v)}
        trailing={
          <Icon
            name="chevron"
            size={11}
            style={{ transform: flatViewsOpen ? undefined : 'rotate(-90deg)', opacity: 0.6 }}
          />
        }
      >
        Flat views
      </NavItem>
      {flatViewsOpen && (
        <>
          <NavItem to="/flat/packages"   indent={1} active={isActive('/flat/packages')}>Packages</NavItem>
          <NavItem to="/flat/entities"   indent={1} active={isActive('/flat/entities')}>Entities</NavItem>
          <NavItem to="/flat/attributes" indent={1} active={isActive('/flat/attributes')}>Attributes</NavItem>
        </>
      )}

      {/* Tools */}
      <SectionLabel>Tools</SectionLabel>

      <NavItem to="/types"         icon="rows"    active={isActive('/types')}>Data Types</NavItem>
      <NavItem to="/design-system" icon="layers" active={isActive('/design-system')}>Design system</NavItem>
      <NavItem to="/settings"      icon="gear"    active={isActive('/settings')}>Settings</NavItem>
    </aside>
  );
};

// ────────── Sub-components ──────────

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className="uppercase"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 10px 4px',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-subtle)',
        letterSpacing: '0.06em',
      }}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

interface NavItemProps {
  to?: string;
  onClick?: () => void;
  icon?: IconName;
  active?: boolean;
  indent?: number;
  subtle?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
}

function NavItem({ to, onClick, icon, active, indent = 0, subtle, trailing, children }: NavItemProps) {
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 10px',
    paddingLeft: 10 + indent * 12,
    height: 32,
    width: '100%',
    textAlign: 'left',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : subtle ? 'var(--text-subtle)' : 'var(--text-muted)',
    fontWeight: active ? 600 : 400,
    border: 'none',
    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    borderRadius: 0,
    cursor: onClick || to ? 'pointer' : 'default',
    fontSize: 'var(--fs-sm)',
    textDecoration: 'none',
    lineHeight: 1.3,
    overflow: 'hidden',
  };

  const content = (
    <>
      {icon && <Icon name={icon} size={13} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      {trailing}
    </>
  );

  const hoverIn = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
  };
  const hoverOut = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
  };

  if (to) {
    return (
      <Link to={to} style={style} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} style={style} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      {content}
    </button>
  );
}

function CollapsedLink({ to, icon, label, active }: { to: string; icon: IconName; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      style={{
        width: 32,
        height: 32,
        display: 'grid',
        placeItems: 'center',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={icon} size={15} />
    </Link>
  );
}

/** Package tree — recursive, expand/collapse per package. */
function renderPackageTree(
  pkgs: Package[],
  parentPath: string[],
  expanded: Record<string, boolean>,
  toggle: (id: string) => void,
  isActive: (path: string) => boolean,
): ReactNode {
  if (!Array.isArray(pkgs)) return null;
  return pkgs.map(pkg => {
    const currentPath = [...parentPath, pkg.name];
    const packageUrl = `/packages/${currentPath.join('/')}`;
    const hasChildren =
      (pkg.subPackages && pkg.subPackages.length > 0) ||
      (pkg.entities && pkg.entities.length > 0);
    const isOpen = !!expanded[pkg.id];

    const pkgActive = isActive(packageUrl);

    return (
      <div key={pkg.id}>
        {/* Package row — active styling (bg + stripe) lives on the outer
            flex container so every row in the tree spans the same width,
            regardless of indent level or whether there's a chevron. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: pkgActive ? 'var(--accent-soft)' : 'transparent',
            borderLeft: pkgActive
              ? '2px solid var(--accent)'
              : '2px solid transparent',
          }}
          onMouseEnter={e => { if (!pkgActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { if (!pkgActive) e.currentTarget.style.background = 'transparent'; }}
        >
          <span
            style={{
              width: 8 + parentPath.length * 10,
              flexShrink: 0,
            }}
          />
          {hasChildren ? (
            <button
              type="button"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              onClick={() => toggle(pkg.id)}
              style={{
                width: 16,
                height: 16,
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-subtle)',
                flexShrink: 0,
              }}
            >
              <Icon name={isOpen ? 'chevron' : 'chevronR'} size={11} />
            </button>
          ) : (
            <span style={{ width: 16, flexShrink: 0 }} />
          )}
          <Link
            to={packageUrl}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px 4px 4px',
              fontSize: 'var(--fs-sm)',
              color: pkgActive ? 'var(--accent)' : 'var(--text)',
              textDecoration: 'none',
              fontWeight: pkgActive ? 600 : 500,
              overflow: 'hidden',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pkg.name}
            </span>
          </Link>
        </div>
        {isOpen && (
          <>
            {pkg.entities?.map(entity => {
              const entityUrl = `${packageUrl}/entities/${entity.name}`;
              const active = isActive(entityUrl);
              return (
                <div
                  key={entity.uuid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    borderLeft: active
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span
                    style={{
                      width: 8 + (parentPath.length + 1) * 10 + 16,
                      flexShrink: 0,
                    }}
                  />
                  <Link
                    to={entityUrl}
                    style={{
                      flex: 1,
                      padding: '3px 8px 3px 0',
                      fontSize: 'var(--fs-xs)',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                      textDecoration: 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {entity.name}
                  </Link>
                </div>
              );
            })}
            {/* Cases as siblings of entities at the same indent level (#121).
                Distinct from entity rows by icon (eye = view) and softer tone
                (--accent-soft). No subheader, no trailing chip — keeps the
                tree dense. Active styling matches entity rows. */}
            {pkg.cases?.map(c => {
              const caseUrl = `/cases/${c.uuid}`;
              const active = isActive(caseUrl);
              return (
                <div
                  key={c.uuid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    borderLeft: active
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span
                    style={{
                      width: 8 + (parentPath.length + 1) * 10,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      width: 16,
                      display: 'grid',
                      placeItems: 'center',
                      color: active ? 'var(--accent)' : 'var(--accent-soft-fg, var(--text-subtle))',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="eye" size={11} />
                  </span>
                  <Link
                    to={caseUrl}
                    style={{
                      flex: 1,
                      padding: '3px 8px 3px 4px',
                      fontSize: 'var(--fs-xs)',
                      color: active ? 'var(--accent)' : 'var(--accent-soft-fg, var(--text-subtle))',
                      textDecoration: 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: active ? 600 : 400,
                      fontStyle: active ? 'normal' : 'italic',
                    }}
                  >
                    {c.name}
                  </Link>
                </div>
              );
            })}
            {pkg.subPackages && pkg.subPackages.length > 0 &&
              renderPackageTree(pkg.subPackages, currentPath, expanded, toggle, isActive)}
          </>
        )}
      </div>
    );
  });
}

export default Sidebar;
