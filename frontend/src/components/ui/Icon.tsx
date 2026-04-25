/**
 * Icon — minimal inline-SVG icon primitive. Only the glyphs used by
 * the app are included; add more to PATHS as new surfaces need them.
 *
 * Preferred over ad-hoc inline SVG in components because every icon
 * then honors stroke width, focus color, and size consistently.
 */

import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'search' | 'filter' | 'columns' | 'sort' | 'density' | 'rows'
  | 'plus' | 'minus' | 'check' | 'close' | 'chevron' | 'chevronR'
  | 'more' | 'moreV' | 'eye' | 'eyeOff' | 'edit' | 'copy'
  | 'key' | 'lock' | 'link' | 'home' | 'folder' | 'layers'
  | 'chart' | 'shield' | 'gear' | 'moon' | 'sun' | 'sparkle'
  | 'warning' | 'info' | 'branch' | 'dot';

const PATHS: Record<IconName, ReactNode> = {
  search:   (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></>),
  filter:   (<path d="M3 5h18M6 12h12M10 19h4" />),
  columns:  (<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M9 4v16M15 4v16" /></>),
  sort:     (<path d="M8 5v14M4 9l4-4 4 4M16 19V5M12 15l4 4 4-4" />),
  density:  (<><rect x="3" y="4" width="18" height="5" rx="1" /><rect x="3" y="11" width="18" height="5" rx="1" /><rect x="3" y="18" width="18" height="2" rx="1" /></>),
  rows:     (<><rect x="3" y="4" width="18" height="5" rx="1" /><rect x="3" y="11" width="18" height="5" rx="1" /><rect x="3" y="18" width="18" height="2" rx="1" /></>),

  plus:     (<path d="M12 5v14M5 12h14" />),
  minus:    (<path d="M5 12h14" />),
  check:    (<path d="m5 12 5 5L20 7" />),
  close:    (<path d="M6 6l12 12M18 6 6 18" />),
  chevron:  (<path d="m6 9 6 6 6-6" />),
  chevronR: (<path d="m9 6 6 6-6 6" />),
  more:     (<><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>),
  moreV:    (<><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></>),

  eye:      (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff:   (<><path d="M2 12s3.5-7 10-7c2 0 3.7.7 5 1.6M22 12s-3.5 7-10 7c-2 0-3.7-.7-5-1.6" /><path d="m4 4 16 16" /></>),
  edit:     (<><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="m13 6 4 4" /></>),
  copy:     (<><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 4H5a1 1 0 0 0-1 1v11" /></>),

  key:      (<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3" /></>),
  lock:     (<><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  link:     (<><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>),
  home:     (<><path d="m3 12 9-9 9 9" /><path d="M5 10v10h14V10" /></>),
  folder:   (<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" />),
  layers:   (<><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5M3 18l9 5 9-5" /></>),
  chart:    (<><path d="M3 20h18" /><path d="M6 16v-6M11 16V8M16 16v-9M21 16v-4" strokeLinecap="round" /></>),
  shield:   (<path d="M12 3 4 6v6c0 4 3.5 7.5 8 9 4.5-1.5 8-5 8-9V6l-8-3z" />),
  gear:     (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
  moon:     (<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  sun:      (<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>),
  sparkle:  (<path d="M12 3v6M12 15v6M3 12h6M15 12h6" />),
  warning:  (<><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v5M12 18v.5" strokeLinecap="round" /></>),
  info:     (<><circle cx="12" cy="12" r="9" /><path d="M12 8v.5M12 11v5" strokeLinecap="round" /></>),
  branch:   (<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 7v10M6 12h6a4 4 0 0 0 4-4" /></>),
  dot:      (<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />),
};

export interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}

const Icon = ({ name, size = 14, stroke = 1.6, className, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0, ...style }}
    aria-hidden
  >
    {PATHS[name]}
  </svg>
);

export default Icon;
