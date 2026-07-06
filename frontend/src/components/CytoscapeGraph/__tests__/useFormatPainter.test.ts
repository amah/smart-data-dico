/**
 * Format painter (#element-style) — the diagram styling logic, tested without a
 * real Cytoscape instance via a fake node (data get/set/removeData) and a mocked
 * servicesApi. Covers the pure badge/label transform, clipboard/arm state, live
 * restyle + persistence in applyToNode, and the one-shot vs sticky tap intercept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { labelWithBadge, useFormatPainter, CLEAR_STYLE } from '../useFormatPainter';
import type { ElementStyle } from '../../../utils/elementStyle';

const setEntityStyle = vi.fn().mockResolvedValue({});
vi.mock('../../../services/api', () => ({ servicesApi: { setEntityStyle: (...a: unknown[]) => setEntityStyle(...a) } }));

const STYLES: ElementStyle[] = [
  { name: 'aggregate-root', label: 'Aggregate Root', badge: 'AR' },
  { name: 'junction', label: 'Relation table' },
];

// Minimal Cytoscape node stand-in: data(k) reads, data(k,v) writes, removeData(k) deletes.
function fakeNode(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { service: 'shop', label: 'Order', name: 'Order', ...initial };
  return {
    store,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: (k: string, v?: unknown): any => { if (v === undefined) return store[k]; store[k] = v; },
    removeData: (k: string) => { delete store[k]; },
  };
}

beforeEach(() => setEntityStyle.mockClear());

describe('labelWithBadge', () => {
  it('returns the bare name with no badge', () => expect(labelWithBadge('Order')).toBe('Order'));
  it('appends a «badge» line', () => expect(labelWithBadge('Order', 'AR')).toBe('Order\n«AR»'));
  it('replaces a prior badge line', () => expect(labelWithBadge('Order\n«OLD»', 'AR')).toBe('Order\n«AR»'));
  it('strips the badge when none is given', () => expect(labelWithBadge('Order\n«AR»')).toBe('Order'));
});

describe('useFormatPainter state', () => {
  it('copyStyle fills the clipboard without arming; copyAndArm arms', () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    act(() => result.current.copyStyle('junction'));
    expect(result.current.clipboard).toBe('junction');
    expect(result.current.armed).toBe(false);

    act(() => result.current.copyAndArm('aggregate-root'));
    expect(result.current.clipboard).toBe('aggregate-root');
    expect(result.current.armed).toBe(true);
  });

  it('toggle is one-shot; armSticky keeps it on; disarm clears both', () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    act(() => result.current.toggle());
    expect(result.current.armed).toBe(true);
    expect(result.current.sticky).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.armed).toBe(false);
    act(() => result.current.armSticky());
    expect(result.current).toMatchObject({ armed: true, sticky: true });
    act(() => result.current.disarm());
    expect(result.current).toMatchObject({ armed: false, sticky: false });
  });

  it('copyStyle(null) stores the CLEAR sentinel', () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    act(() => result.current.copyStyle(null));
    expect(result.current.clipboard).toBe(CLEAR_STYLE);
  });
});

describe('applyToNode', () => {
  it('sets styleName + «badge» label and persists the override', async () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    const node = fakeNode();
    await act(async () => { await result.current.applyToNode(node as never, 'aggregate-root'); });
    expect(node.store.styleName).toBe('aggregate-root');
    expect(node.store.displayLabel).toBe('Order\n«AR»');
    expect(setEntityStyle).toHaveBeenCalledWith('shop', 'Order', 'aggregate-root');
  });

  it('clears the style (removeData + null persist) for CLEAR_STYLE', async () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    const node = fakeNode({ styleName: 'aggregate-root', displayLabel: 'Order\n«AR»' });
    await act(async () => { await result.current.applyToNode(node as never, CLEAR_STYLE); });
    expect(node.store.styleName).toBeUndefined();
    expect(node.store.displayLabel).toBe('Order');
    expect(setEntityStyle).toHaveBeenCalledWith('shop', 'Order', null);
  });

  it('rolls back the optimistic change and surfaces the error when the save fails', async () => {
    setEntityStyle.mockRejectedValueOnce({ response: { status: 403 } });
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    const node = fakeNode({ styleName: 'base', displayLabel: 'Order' });
    await act(async () => { await result.current.applyToNode(node as never, 'aggregate-root'); });
    expect(node.store.styleName).toBe('base');       // reverted, not left as aggregate-root
    expect(node.store.displayLabel).toBe('Order');
    expect(result.current.error).toMatch(/not authorised/i);
  });

  it('sets an error (no request) when the node has no resolvable package', async () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, undefined));
    const node = { store: {}, data: (k: string) => (k === 'label' ? 'Ghost' : undefined), removeData: () => {}, id: () => 'x' };
    await act(async () => { await result.current.applyToNode(node as never, 'junction'); });
    expect(result.current.error).toMatch(/package is unknown/i);
    expect(setEntityStyle).not.toHaveBeenCalled();
  });
});

describe('interceptTap', () => {
  it('returns false (no paint) when the brush is idle', () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    expect(result.current.interceptTap(fakeNode() as never)).toBe(false);
    expect(setEntityStyle).not.toHaveBeenCalled();
  });

  it('one-shot: paints once then disarms', async () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    act(() => result.current.copyAndArm('junction')); // armed, not sticky
    const node = fakeNode();
    let handled = false;
    act(() => { handled = result.current.interceptTap(node as never); });
    expect(handled).toBe(true);
    expect(node.store.styleName).toBe('junction');           // live restyle (synchronous)
    expect(result.current.armed).toBe(false);                // one-shot disarmed
    await waitFor(() => expect(setEntityStyle).toHaveBeenCalledWith('shop', 'Order', 'junction'));
  });

  it('sticky: stays armed across paints', () => {
    const { result } = renderHook(() => useFormatPainter(null, STYLES, 'shop'));
    act(() => { result.current.copyStyle('junction'); result.current.armSticky(); });
    act(() => { result.current.interceptTap(fakeNode() as never); });
    expect(result.current.armed).toBe(true);
    act(() => { result.current.interceptTap(fakeNode({ label: 'Product', name: 'Product' }) as never); });
    expect(result.current.armed).toBe(true);
  });
});
