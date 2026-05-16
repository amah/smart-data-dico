import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { Rule, RuleSeverityValue, RuleEnforcement } from '../../../../types';
import RuleEditor from './RuleEditor';
import { formatRuleName } from '../../../../utils/formatRuleName';

interface RulesSidePanelProps {
  /** Title shown in the panel header — e.g. "Rules for Customer.email". */
  title: string;
  /** All rules to display. The panel handles sorting + grouping itself. */
  rules: Rule[];
  /** Whether the panel is open. */
  open: boolean;
  /** Close handler. */
  onClose: () => void;
  /** Called when a rule is created, edited, or deleted — parent should refetch. */
  onRulesChanged?: () => void;
}

const severityRank: Record<RuleSeverityValue, number> = { error: 0, warning: 1, info: 2 };
const enforcementRank: Record<RuleEnforcement, number> = { save: 0, process: 1, advisory: 2 };

const severityBadgeClass = (s: RuleSeverityValue) =>
  s === 'error' ? 'badge-error' : s === 'warning' ? 'badge-warning' : 'badge-info';

const enforcementBadgeClass = (e: RuleEnforcement) =>
  e === 'save' ? 'badge-error' : e === 'process' ? 'badge-warning' : 'badge-ghost';

const enforcementLabel = (e: RuleEnforcement) =>
  e === 'save' ? 'blocks save' : e === 'process' ? 'process gate' : 'advisory';

const sourceChipFor = (rule: Rule): { label: string; cls: string } => {
  switch (rule.scope) {
    case 'entity': return { label: 'entity', cls: 'badge-primary' };
    case 'package': return { label: 'package', cls: 'badge-secondary' };
    case 'case': return { label: 'case', cls: 'badge-accent' };
    default: return { label: rule.scope, cls: 'badge-ghost' };
  }
};

const RulesSidePanel = ({
  title,
  rules,
  open,
  onClose,
  onRulesChanged,
}: RulesSidePanelProps) => {
  const [editorRule, setEditorRule] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    return [...rules].sort((a, b) => {
      // Primary: enforcement rank (save → process → advisory)
      const e = enforcementRank[a.enforcement] - enforcementRank[b.enforcement];
      if (e !== 0) return e;
      // Secondary: severity rank (error → warning → info)
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

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-30 z-40"
        onClick={onClose}
        aria-label="Close panel"
      />

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 h-full w-full max-w-2xl bg-base-100 shadow-2xl z-50 flex flex-col"
        role="dialog"
        aria-label={title}
      >
        {/* Header */}
        <div className="border-b border-base-300 p-4 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{title}</h2>
            <div className="text-xs text-base-content/60 mt-1 flex flex-wrap gap-2">
              <span>{summary.total} rule{summary.total === 1 ? '' : 's'}</span>
              {summary.byEnforcement.save > 0 && (
                <span>· {summary.byEnforcement.save} blocking save</span>
              )}
              {summary.byEnforcement.process > 0 && (
                <span>· {summary.byEnforcement.process} process gate{summary.byEnforcement.process === 1 ? '' : 's'}</span>
              )}
            </div>
          </div>
          <button
            className="btn btn-sm btn-ghost btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="border-b border-base-300 px-4 py-2 flex items-center gap-2">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setCreating(true)}
          >
            + New Rule
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sorted.length === 0 && (
            <div className="text-center text-base-content/50 py-8">
              No rules yet. Click "+ New Rule" to add one.
            </div>
          )}

          {sorted.map(rule => {
            const isExpanded = expanded.has(rule.uuid);
            const source = sourceChipFor(rule);
            const display = formatRuleName(rule, 'attribute');
            return (
              <div
                key={rule.uuid}
                className="card card-compact bg-base-200"
              >
                <div className="card-body">
                  {/* Top line: name + badges */}
                  <div className="flex items-start gap-2 flex-wrap">
                    <h3 className="font-medium flex-1 break-all">{display}</h3>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={`badge badge-xs ${severityBadgeClass(rule.severity)}`}>
                        {rule.severity}
                      </span>
                      <span
                        className={`badge badge-xs ${enforcementBadgeClass(rule.enforcement)}`}
                        title={enforcementLabel(rule.enforcement)}
                      >
                        {rule.enforcement}
                      </span>
                      <span className={`badge badge-xs ${source.cls}`}>{source.label}</span>
                    </div>
                  </div>

                  {/* Description */}
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

                  {/* Tags */}
                  {rule.tags && rule.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rule.tags.map(tag => (
                        <span key={tag} className="badge badge-xs badge-ghost">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
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
      </aside>

      {/* Editor modal — opens on top of the side panel */}
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
    </>
  );
};

export default RulesSidePanel;
