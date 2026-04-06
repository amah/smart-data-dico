import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import EditableCell from '../EditableCell';

// Helper to render EditableCell inside a table
const renderCell = (props: React.ComponentProps<typeof EditableCell>) => {
  return render(
    <table>
      <tbody>
        <tr>
          <EditableCell {...props} />
        </tr>
      </tbody>
    </table>
  );
};

describe('EditableCell', () => {
  let onSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn().mockResolvedValue(undefined);
  });

  // ──────────────────────────────────────────────
  // Display mode
  // ──────────────────────────────────────────────

  describe('Display mode', () => {
    it('renders text value', () => {
      renderCell({ value: 'Hello', onSave });
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders dash for empty string', () => {
      renderCell({ value: '', onSave });
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('renders custom display via renderDisplay', () => {
      renderCell({
        value: 'raw',
        onSave,
        renderDisplay: (v) => <span data-testid="custom">{v.toString().toUpperCase()}</span>,
      });
      expect(screen.getByTestId('custom')).toHaveTextContent('RAW');
    });

    it('does not enter edit mode when disabled', async () => {
      renderCell({ value: 'locked', onSave, disabled: true });
      const cell = screen.getByText('locked').closest('td')!;
      await userEvent.click(cell);
      // Should still show the display text, not an input
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Text input editing
  // ──────────────────────────────────────────────

  describe('Text input', () => {
    it('enters edit mode on click and shows input with current value', async () => {
      renderCell({ value: 'Hello', onSave });
      const cell = screen.getByText('Hello').closest('td')!;
      await userEvent.click(cell);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('Hello');
    });

    it('saves on Enter', async () => {
      renderCell({ value: 'Hello', onSave });
      await userEvent.click(screen.getByText('Hello').closest('td')!);
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'World{enter}');
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('World');
      });
    });

    it('saves on blur', async () => {
      renderCell({ value: 'Hello', onSave });
      await userEvent.click(screen.getByText('Hello').closest('td')!);
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'Blurred');
      fireEvent.blur(input);
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('Blurred');
      });
    });

    it('cancels on Escape without saving', async () => {
      renderCell({ value: 'Hello', onSave });
      await userEvent.click(screen.getByText('Hello').closest('td')!);
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'Changed');
      await userEvent.keyboard('{Escape}');
      expect(onSave).not.toHaveBeenCalled();
      // Should revert to display mode with original value
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('does not call onSave when value is unchanged', async () => {
      renderCell({ value: 'Same', onSave });
      await userEvent.click(screen.getByText('Same').closest('td')!);
      const input = screen.getByRole('textbox');
      fireEvent.blur(input);
      await waitFor(() => {
        expect(onSave).not.toHaveBeenCalled();
      });
    });

    it('shows green highlight after successful save', async () => {
      renderCell({ value: 'Hello', onSave });
      await userEvent.click(screen.getByText('Hello').closest('td')!);
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'Saved{enter}');
      // After save, it exits edit mode and shows original prop (since parent doesn't update)
      // but the cell should have the success highlight
      await waitFor(() => {
        const cell = screen.getByText('Hello').closest('td')!;
        expect(cell.className).toContain('bg-success/10');
      });
    });

    it('shows red highlight and reverts on save failure', async () => {
      const failingSave = vi.fn().mockRejectedValue(new Error('fail'));
      renderCell({ value: 'Hello', onSave: failingSave });
      await userEvent.click(screen.getByText('Hello').closest('td')!);
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'Bad{enter}');
      await waitFor(() => {
        // Should revert to original value
        expect(screen.getByText('Hello')).toBeInTheDocument();
      });
      // Error highlight should appear
      const cell = screen.getByText('Hello').closest('td')!;
      expect(cell.className).toContain('bg-error/10');
    });
  });

  // ──────────────────────────────────────────────
  // Textarea input editing
  // ──────────────────────────────────────────────

  describe('Textarea input', () => {
    it('renders textarea in edit mode', async () => {
      renderCell({ value: 'Description', inputType: 'textarea', onSave });
      await userEvent.click(screen.getByText('Description').closest('td')!);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.tagName).toBe('TEXTAREA');
      expect(textarea.value).toBe('Description');
    });

    it('saves on Enter (without Shift)', async () => {
      renderCell({ value: 'Desc', inputType: 'textarea', onSave });
      await userEvent.click(screen.getByText('Desc').closest('td')!);
      const textarea = screen.getByRole('textbox');
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'New desc');
      // Press Enter without shift
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('New desc');
      });
    });

    it('does not save on Shift+Enter (allows newline)', async () => {
      renderCell({ value: 'Desc', inputType: 'textarea', onSave });
      await userEvent.click(screen.getByText('Desc').closest('td')!);
      const textarea = screen.getByRole('textbox');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // Select input editing
  // ──────────────────────────────────────────────

  describe('Select input', () => {
    const options = [
      { value: 'string', label: 'String' },
      { value: 'number', label: 'Number' },
      { value: 'boolean', label: 'Boolean' },
    ];

    it('shows dropdown on click and saves on change', async () => {
      renderCell({ value: 'string', inputType: 'select', options, onSave });
      await userEvent.click(screen.getByText('string').closest('td')!);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      expect(select.value).toBe('string');

      await userEvent.selectOptions(select, 'number');
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('number');
      });
    });
  });

  // ──────────────────────────────────────────────
  // Toggle input
  // ──────────────────────────────────────────────

  describe('Toggle input', () => {
    it('renders Yes badge for true value', () => {
      renderCell({ value: true, inputType: 'toggle', onSave });
      expect(screen.getByText('Yes')).toBeInTheDocument();
    });

    it('renders No badge for false value', () => {
      renderCell({ value: false, inputType: 'toggle', onSave });
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('toggles value on click (true → false)', async () => {
      renderCell({ value: true, inputType: 'toggle', onSave });
      const cell = screen.getByText('Yes').closest('td')!;
      await userEvent.click(cell);
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(false);
      });
    });

    it('toggles value on click (false → true)', async () => {
      renderCell({ value: false, inputType: 'toggle', onSave });
      const cell = screen.getByText('No').closest('td')!;
      await userEvent.click(cell);
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(true);
      });
    });

    it('does not toggle when disabled', async () => {
      renderCell({ value: true, inputType: 'toggle', onSave, disabled: true });
      const cell = screen.getByText('Yes').closest('td')!;
      await userEvent.click(cell);
      expect(onSave).not.toHaveBeenCalled();
    });

    it('shows spinner while saving', async () => {
      const slowSave = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 500)));
      renderCell({ value: true, inputType: 'toggle', onSave: slowSave });
      const cell = screen.getByText('Yes').closest('td')!;
      await userEvent.click(cell);
      // Spinner should be visible
      expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
    });
  });
});
