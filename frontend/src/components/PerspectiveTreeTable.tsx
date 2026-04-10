import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { ResolvedNode } from '../types';

// ────────────────────────────────────────────────────────────────────────
// Tree data model
// ────────────────────────────────────────────────────────────────────────

export interface TreeNode {
  /** Unique key for React — uses the full path string. */
  path: string;
  /** Segment label shown in the tree (entity name or nav property). */
  label: string;
  /** The resolved node data (null for synthetic nav-property nodes). */
  node: ResolvedNode | null;
  children: TreeNode[];
  depth: number;
}

/**
 * Build a tree from the flat resolved-node array.
 *
 * Paths use `/` separators with alternating entity and relationship-nav
 * segments: `"Order/items/OrderItem/product/Product"`.
 *
 * Root nodes (hopDistance 0) become top-level tree entries. Their children
 * are built by grouping on shared path prefixes.
 */
function buildTree(nodes: ResolvedNode[]): TreeNode[] {
  // Sort by path for stable grouping
  const sorted = [...nodes].sort((a, b) => a.path.localeCompare(b.path));

  const root: TreeNode[] = [];
  // Map from path → TreeNode for quick parent lookup
  const nodeMap = new Map<string, TreeNode>();

  for (const n of sorted) {
    const segments = n.path.split('/');
    const treeNode: TreeNode = {
      path: n.path,
      label: n.entityName,
      node: n,
      children: [],
      depth: n.hopDistance,
    };
    nodeMap.set(n.path, treeNode);

    if (n.isRoot || segments.length <= 1) {
      root.push(treeNode);
      continue;
    }

    // Parent path: everything except the last two segments (nav + entity)
    // e.g., "Order/items/OrderItem" → parent = "Order"
    const parentPath = segments.slice(0, -2).join('/');
    const parentNode = nodeMap.get(parentPath);

    if (parentNode) {
      // Insert a nav-property bridge node between parent and child
      const navName = segments[segments.length - 2];
      // Check if we already have this nav bridge under the parent
      let navBridge = parentNode.children.find(
        (c) => c.node === null && c.label === navName,
      );
      if (!navBridge) {
        navBridge = {
          path: `${parentPath}/${navName}`,
          label: navName,
          node: null,
          children: [],
          depth: parentNode.depth + 1,
        };
        parentNode.children.push(navBridge);
      }
      navBridge.children.push(treeNode);
    } else {
      // Fallback: no parent found — attach to root
      root.push(treeNode);
    }
  }

  return root;
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

interface Props {
  nodes: ResolvedNode[];
}

const DEFAULT_EXPAND_DEPTH = 2;

export default function PerspectiveTreeTable({ nodes }: Props) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // Expanded state: Set of path strings that are expanded
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand all nodes up to DEFAULT_EXPAND_DEPTH
    const initial = new Set<string>();
    function walk(items: TreeNode[]) {
      for (const item of items) {
        if (item.depth < DEFAULT_EXPAND_DEPTH && item.children.length > 0) {
          initial.add(item.path);
          walk(item.children);
        }
      }
    }
    walk(tree);
    return initial;
  });

  // Search filter
  const [filter, setFilter] = useState('');

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    function walk(items: TreeNode[]) {
      for (const item of items) {
        if (item.children.length > 0) {
          all.add(item.path);
          walk(item.children);
        }
      }
    }
    walk(tree);
    setExpanded(all);
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Filter: find matching nodes and keep their ancestors visible
  const matchingPaths = useMemo(() => {
    if (!filter.trim()) return null;
    const term = filter.toLowerCase();
    const matches = new Set<string>();
    function walk(items: TreeNode[]) {
      for (const item of items) {
        const label = item.node?.entityName || item.label;
        if (label.toLowerCase().includes(term) || item.node?.service.toLowerCase().includes(term)) {
          // Mark this node and all ancestors
          const segments = item.path.split('/');
          for (let i = 1; i <= segments.length; i++) {
            matches.add(segments.slice(0, i).join('/'));
          }
        }
        walk(item.children);
      }
    }
    walk(tree);
    return matches;
  }, [tree, filter]);

  // Flatten visible rows for rendering
  const rows = useMemo(() => {
    const result: { node: TreeNode; indent: number; hasChildren: boolean; isExpanded: boolean }[] = [];
    function walk(items: TreeNode[], indent: number) {
      for (const item of items) {
        // Apply filter
        if (matchingPaths && !matchingPaths.has(item.path)) continue;
        const hasChildren = item.children.length > 0;
        const isExpanded = expanded.has(item.path);
        result.push({ node: item, indent, hasChildren, isExpanded });
        if (hasChildren && (isExpanded || matchingPaths)) {
          walk(item.children, indent + 1);
        }
      }
    }
    walk(tree, 0);
    return result;
  }, [tree, expanded, matchingPaths]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter entities..."
          className="input input-sm input-bordered flex-1 max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn btn-xs btn-ghost" onClick={expandAll}>Expand all</button>
        <button className="btn btn-xs btn-ghost" onClick={collapseAll}>Collapse all</button>
        <span className="text-xs text-base-content/50 ml-auto">{nodes.length} nodes</span>
      </div>

      {/* Tree table */}
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Service</th>
              <th>Hops</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node: treeNode, indent, hasChildren, isExpanded }) => {
              const rn = treeNode.node; // resolved node (null for nav bridges)
              const isNavBridge = rn === null;

              return (
                <tr key={treeNode.path} className="hover">
                  <td>
                    <div
                      className="flex items-center gap-1"
                      style={{ paddingLeft: `${indent * 1.25}rem` }}
                    >
                      {/* Expand/collapse chevron */}
                      {hasChildren ? (
                        <button
                          className="btn btn-ghost btn-xs px-0 min-h-0 h-5 w-5"
                          onClick={() => toggle(treeNode.path)}
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <svg
                            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ) : (
                        <span className="w-5" />
                      )}

                      {isNavBridge ? (
                        <span className="text-base-content/40 italic text-xs">{treeNode.label}</span>
                      ) : (
                        <Link
                          to={`/packages/${rn!.service}/entities/${rn!.entityName}`}
                          className="link link-primary"
                        >
                          {rn!.entityName}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td>
                    {rn && <span className="badge badge-ghost badge-sm">{rn.service}</span>}
                  </td>
                  <td>{rn ? rn.hopDistance : ''}</td>
                  <td>
                    {rn?.isRoot && <span className="badge badge-primary badge-sm mr-1">root</span>}
                    {rn?.isFrontier && <span className="badge badge-warning badge-sm mr-1">frontier</span>}
                    {rn?.isManualInclusion && <span className="badge badge-info badge-sm">included</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-base-content/50 py-8">
                  {filter ? 'No matching entities found' : 'No resolved paths'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
