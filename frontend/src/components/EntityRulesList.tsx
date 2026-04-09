import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { Rule, RuleSeverityValue, RuleEnforcement, Attribute } from '../types';
import RuleEditor from './RuleEditor';
import { formatRuleName } from '../utils/formatRuleName';

interface EntityRulesListProps {
  /** Display name of the parent entity (used in the empty state). */
  entityName: string;
  /** Attributes belonging to this entity (used to resolve attribute names for display). */
  attributes: Attribute[];
  /** All rules touching the entity. */
  rules: Rule[];
  /** Called after a rule is created / edited / deleted so the parent can refetch. */
  onRulesChanged?: () => void;
}

const severityRank: Record<RuleSeverityValue, number> = { error: 0, warning: 1, info: 2 };
const enforcementRank: Record<RuleEnforcement, number> = { save: 0, process: 1, advisory: 2 };

const severityBadgeClass = (s: RuleSeverityValue) =>
  s === 'error' ? 'badge-error' : s === 'warning' ? 'badge-warning' : 'badge-info';

const enforcementBadgeClass = (e: RuleEnforcement) =>
  e === 'save' ? 'badge-error' : e === 'process' ? 'badge-warning' : 'badge-ghost';

const sourceChipFor = (rule: Rule): { label: string; cls: string } => {
  switch (rule.scope) {
    case 'entity': return { label: 'entity', cls: 'badge-primary' };
    case 'package': return { label: 'package', cls: 'badge-secondary' };
    case 'perspective': return { label: 'perspective', cls: 'badge-accent' };
    default: return { label: rule.scope, cls: 'badge-ghost' };
  }
};

/**
 * Inline rules list for the entity detail "Rules" tab (#74 C4).
 *
 * Mirrors the layout of `RulesSidePanel` (same card shape, same sort order)
 * but flows in the page body rather than sliding in from the right. Reuses
 * `RuleEditor` for create/edit.
 */
const EntityRulesList = ({
  entityName,
  attributes,
  rules,
  onRulesChanged,
}: EntityRulesListProps) => {
  const [editorRule, setEditorRule] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    return [...rules].sort((a, b) => {
      const e = enforcementRank[a.enforcement] - enforcementRank[b.enforcement];
      if (e !== 0) return e;
      const s = severityRank[a.severity] - severityRank[b.severity];
      if (s !== 0) return s;
      return a.name.localeCompare(b.name);
    });
  }, [rules]);

  const summary = useMemo(() => {
    const byEnforcement: Record<RuleEnforcement, number> = { save: 0, process: 0, advisory: 0 };
    for (const r of rules) {
      byEnforcement[r.enforcement] = (byEnforcement[r.enforcement] || 0) + 1;
    }
    return { byEnforcement, total: rules.length };
  }, [rules]);

  // Resolver: attribute UUID → name (for cross-attribute rule name display)
  const attrNameByUuid = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of attributes) map[a.uuid] = a.name;
    return map;
  }, [attributes]);

  const toggleExpanded = (uuid: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const handleEditorSaved = () => {
    setEditorRule(null);
    setCreating(false);
    onRulesChanged?.();
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm text-base-content/60">
            {summary.total} rule{summary.total === 1 ? '' : 's'}
            {summary.byEnforcement.save > 0 && <> · {summary.byEnforcement.save} blocking save</>}
            {summary.byEnforcement.process > 0 && (
              <> · {summary.byEnforcement.process} process gate{summary.byEnforcement.process === 1 ? '' : 's'}</>
            )}
          </div>
        </div>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => setCreating(true)}
        >
          + New Rule
        </button>
      </div>

      {/* Empty state */}
      {sorted.length === 0 && (
        <div className="alert alert-info">
          <span>
            No rules yet for <strong>{entityName}</strong>. Click{' '}
            <strong>+ New Rule</strong> to author a functional rule, or set{' '}
            attribute validation (maxLength, pattern, format, …) via the
            per-attribute editor.
          </span>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sorted.map(rule => {
          const isExpanded = expanded.has(rule.uuid);
          const source = sourceChipFor(rule);
          const display = formatRuleName(rule, 'entity', {
            attributeName: (uuid) => attrNameByUuid[uuid],
          });
          return (
            <div
              key={rule.uuid}
              className="card card-compact bg-base-200"
            >
              <div className="card-body">
                <div className="flex items-start gap-2 flex-wrap">
                  <h3 className="font-medium flex-1 break-all">{display}</h3>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className={`badge badge-xs ${severityBadgeClass(rule.severity)}`}>
                      {rule.severity}
                    </span>
                    <span className={`badge badge-xs ${enforcementBadgeClass(rule.enforcement)}`}>
                      {rule.enforcement}
                    </span>
                    <span className={`badge badge-xs ${source.cls}`}>{source.label}</span>
                  </div>
                </div>

                <div
                  className={`prose prose-sm prose-invert max-w-none mt-1 ${
                    isExpanded ? '' : 'line-clamp-3'
                  }`}
                >
                  <Markdown>{rule.description || '*(no description)*'}</Markdown>
                </div>

                {rule.description && rule.description.split('\n').length > 3 && (
                  <button
                    className="btn btn-xs btn-ghost self-start mt-1"
                    onClick={() => toggleExpanded(rule.uuid)}
                  >
                    {isExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}

                {rule.tags && rule.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {rule.tags.map(tag => (
                      <span key={tag} className="badge badge-xs badge-ghost">{tag}</span>
                    ))}
                  </div>
                )}

                <div className="card-actions justify-end mt-2">
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => setEditorRule(rule)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor modal */}
      {(editorRule || creating) && (
        <RuleEditor
          rule={editorRule}
          onClose={() => {
            setEditorRule(null);
            setCreating(false);
          }}
          onSaved={handleEditorSaved}
        />
      )}
    </div>
  );
};

export default EntityRulesList;
