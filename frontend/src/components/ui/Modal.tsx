/**
 * Modal — centered dialog with backdrop, used for create/confirm flows.
 *
 * Renders nothing when `open` is false. Clicking the backdrop or the
 * close icon fires `onClose`; Esc also closes. Consumers own the body
 * content and footer — this primitive just provides the frame and
 * header.
 */

import { useEffect, type ReactNode } from 'react';
import Button from './Button';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Max width of the dialog. Defaults to 480px. */
  width?: number;
}

const Modal = ({ open, title, onClose, children, width = 480 }: ModalProps) => {
  // Esc-to-close. Hooked only while open so it doesn't compete with
  // other surfaces when the modal isn't mounted.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 40,
        }}
      />
      <div
        role="dialog"
        aria-label={title}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: `min(90vw, ${width}px)`,
          maxHeight: '80vh',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>
            {title}
          </h2>
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="close" onClick={onClose} iconOnly aria-label="close" />
        </div>
        <div
          style={{
            padding: 14,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
};

export default Modal;
