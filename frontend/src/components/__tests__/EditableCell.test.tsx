import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  // Typed so it's assignable to EditableCell's onSave prop
  // ((v) => Promise<void>) while still exposing vitest's Mock helpers.
  let onSave: ReturnType<typeof vi.fn<[string | number | boolean], Promise<void>>>;

  beforeEach(() => {
    onSave = vi.fn<[string | number | boolean], Promise<void>>().mockResolvedValue(undefined);
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
        expect(screen.getByText('Hello')).toBeInTheDocument();
      });
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
  // Toggle input — checkbox-based (#70)
  // ──────────────────────────────────────────────

  describe('Toggle input', () => {
    it('renders a checked checkbox for true value', () => {
      renderCell({ value: true, inputType: 'toggle', onSave });
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.checked).toBe(true);
    });

    it('renders an unchecked checkbox for false value', () => {
      renderCell({ value: false, inputType: 'toggle', onSave });
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('flips value on checkbox click (true → false)', async () => {
      renderCell({ value: true, inputType: 'toggle', onSave });
      await userEvent.click(screen.getByRole('checkbox'));
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(false);
      });
    });

    it('flips value on checkbox click (false → true)', async () => {
      renderCell({ value: false, inputType: 'toggle', onSave });
      await userEvent.click(screen.getByRole('checkbox'));
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(true);
      });
    });

    it('clicking the cell area (not the checkbox) does NOT flip the value', async () => {
      renderCell({ value: true, inputType: 'toggle', onSave });
      const cell = screen.getByRole('checkbox').closest('td')!;
      // The cell has no onClick handler, so firing a click event on the td
      // (not the checkbox child) should be a no-op.
      fireEvent.click(cell);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('does not flip when disabled', async () => {
      renderCell({ value: true, inputType: 'toggle', onSave, disabled: true });
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
      await userEvent.click(checkbox);
      expect(onSave).not.toHaveBeenCalled();
    });

    it('shows spinner while saving', async () => {
      const slowSave = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 500)));
      renderCell({ value: true, inputType: 'toggle', onSave: slowSave });
      await userEvent.click(screen.getByRole('checkbox'));
      expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
    });

    it('uses the provided ariaLabel', () => {
      renderCell({ value: true, inputType: 'toggle', onSave, ariaLabel: 'Required' });
      expect(screen.getByLabelText('Required')).toBeInTheDocument();
    });
  });
});
