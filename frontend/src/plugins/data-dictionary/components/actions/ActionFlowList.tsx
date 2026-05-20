/**
 * ActionFlowList — renders an action's flow body as a stepped list.
 *
 * v1: read-only display of flow steps. Each step kind is rendered as a
 * distinct typed row. Branching steps show nested then/else sub-lists.
 * Editing is handled by the parent ActionPanel form.
 */

import type { FlowStep, FlowStepKind } from '../../../../types';

interface ActionFlowListProps {
  flow: FlowStep[];
  depth?: number;
}

const STEP_KIND_LABELS: Record<FlowStepKind, string> = {
  assign: 'Assign',
  emitEvent: 'Emit event',
  invokeAction: 'Invoke action',
  branch: 'Branch',
  wait: 'Wait',
  callExternal: 'Call external',
};

const STEP_KIND_COLORS: Record<FlowStepKind, string> = {
  assign: 'var(--accent)',
  emitEvent: 'var(--success)',
  invokeAction: 'var(--accent)',
  branch: 'var(--warning)',
  wait: 'var(--text-subtle)',
  callExternal: 'var(--danger)',
};

function StepRow({ step, depth = 0 }: { step: FlowStep; depth?: number }) {
  const label = STEP_KIND_LABELS[step.kind] || step.kind;
  const color = STEP_KIND_COLORS[step.kind] || 'var(--text-muted)';
  const indent = depth * 16;

  return (
    <div
      style={{
        paddingLeft: indent + 8,
        paddingTop: 4,
        paddingBottom: 4,
        borderLeft: depth > 0 ? '2px solid var(--border)' : 'none',
        marginLeft: depth > 0 ? 8 : 0,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {/* Kind badge */}
        <span
          style={{
            display: 'inline-block',
            minWidth: 88,
            padding: '1px 6px',
            borderRadius: 3,
            background: `${color}22`,
            color,
            fontSize: 'var(--fs-xs)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {label}
        </span>

        {/* Step details */}
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {step.kind === 'assign' && (
            <>{step.target} = <span style={{ color: 'var(--text-subtle)' }}>{step.value}</span></>
          )}
          {step.kind === 'emitEvent' && (
            <span style={{ color: 'var(--text-subtle)' }}>{step.name}</span>
          )}
          {step.kind === 'invokeAction' && (
            <span style={{ color: 'var(--text-subtle)' }}>{step.actionRef}</span>
          )}
          {step.kind === 'wait' && (
            <>for <span style={{ color: 'var(--text-subtle)' }}>{step.for}</span></>
          )}
          {step.kind === 'callExternal' && (
            <span style={{ color: 'var(--text-subtle)' }}>{step.target}</span>
          )}
          {step.kind === 'branch' && (
            <span style={{ color: 'var(--text-subtle)' }}>{step.when}</span>
          )}
        </span>
      </div>

      {/* Branch sub-lists */}
      {step.kind === 'branch' && step.then && step.then.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 2, paddingLeft: 8 }}>
            then:
          </div>
          <ActionFlowList flow={step.then} depth={depth + 1} />
        </div>
      )}
      {step.kind === 'branch' && step.else && step.else.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 2, paddingLeft: 8 }}>
            else:
          </div>
          <ActionFlowList flow={step.else} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

export function ActionFlowList({ flow, depth = 0 }: ActionFlowListProps) {
  if (!flow || flow.length === 0) {
    return (
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        No steps
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {flow.map((step, idx) => (
        <StepRow key={idx} step={step} depth={depth} />
      ))}
    </div>
  );
}
