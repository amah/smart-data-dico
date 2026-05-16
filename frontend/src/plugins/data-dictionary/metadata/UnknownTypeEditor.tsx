import React from 'react';
import type { MetadataValue, MetadataDefinition } from '../../../types';
import type { MetadataTypeContribution, MetadataEditorInputProps, MetadataViewerProps } from './MetadataTypeRegistry';

// ─── Viewer ────────────────────────────────────────────────────────────────

function UnknownTypeViewer({ value, def }: MetadataViewerProps<MetadataValue>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="badge badge-warning badge-xs">unknown type: {def.type}</span>
      <pre style={{ fontSize: '0.7rem', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// ─── Editor (read-only) ────────────────────────────────────────────────────

function UnknownTypeEditor({ value, def }: MetadataEditorInputProps<MetadataValue>) {
  return <UnknownTypeViewer value={value} def={def} />;
}

// ─── Contribution ─────────────────────────────────────────────────────────

export const UnknownTypeContribution: MetadataTypeContribution<MetadataValue> = {
  type: '__unknown__',
  label: 'Unknown',
  defaultValue: '',
  validate: () => ({ ok: true, errors: [] }),
  serialize: (v) => v,
  parse: (raw) => (raw as MetadataValue) ?? '',
  toJsonSchema: () => ({}),
  toMarkdown: (v) => String(v),
  Editor: UnknownTypeEditor,
  Viewer: UnknownTypeViewer,
};

export default UnknownTypeContribution;
