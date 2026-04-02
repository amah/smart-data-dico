import { SHORTCUT_LIST } from '../hooks/useKeyboardShortcuts';

interface Props {
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ onClose }: Props) {
  // Group by context
  const groups: Record<string, typeof SHORTCUT_LIST> = {};
  for (const s of SHORTCUT_LIST) {
    if (!groups[s.context]) groups[s.context] = [];
    groups[s.context].push(s);
  }

  return (
    <dialog className="modal modal-open" style={{ zIndex: 9999 }}>
      <div className="modal-box max-w-lg">
        <h3 className="font-bold text-lg mb-4">Keyboard Shortcuts</h3>

        {Object.entries(groups).map(([context, shortcuts]) => (
          <div key={context} className="mb-4">
            <h4 className="text-sm font-semibold text-base-content/60 mb-2">{context}</h4>
            <div className="space-y-1">
              {shortcuts.map(s => (
                <div key={s.key} className="flex items-center justify-between py-1">
                  <span className="text-sm">{s.label}</span>
                  <kbd className="kbd kbd-sm">{s.key}</kbd>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="modal-action">
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
