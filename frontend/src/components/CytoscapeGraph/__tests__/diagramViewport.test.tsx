import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Core } from 'cytoscape';
import DiagramViewportControl from '../DiagramViewportControl';
import { recenterDiagram } from '../diagramViewport';

function fakeCore(options: { destroyed?: boolean; elements?: number } = {}) {
  const resize = vi.fn();
  const fit = vi.fn();
  const core = {
    destroyed: () => options.destroyed ?? false,
    resize,
    fit,
    elements: () => ({ length: options.elements ?? 1 }),
  } as unknown as Core;
  return { core, resize, fit };
}

describe('diagram viewport recovery', () => {
  it('resizes the renderer before fitting the model', () => {
    const { core, resize, fit } = fakeCore();

    recenterDiagram(core);

    expect(resize).toHaveBeenCalledOnce();
    expect(fit).toHaveBeenCalledWith(undefined, 40);
    expect(resize.mock.invocationCallOrder[0]).toBeLessThan(fit.mock.invocationCallOrder[0]);
  });

  it('exposes an always-visible recenter action', async () => {
    const { core, resize, fit } = fakeCore();
    const cyRef = { current: core };
    render(<DiagramViewportControl cyRef={cyRef} />);

    await userEvent.click(screen.getByRole('button', { name: 'Recenter diagram' }));

    expect(resize).toHaveBeenCalledOnce();
    expect(fit).toHaveBeenCalledOnce();
  });

  it('does nothing after the graph has been destroyed', () => {
    const { core, resize, fit } = fakeCore({ destroyed: true });

    recenterDiagram(core);

    expect(resize).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
  });
});
