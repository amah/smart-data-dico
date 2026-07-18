/**
 * ShellLayout
 *
 * Adapts the current Layout.tsx to work within the shell plugin system.
 * Renders existing Navbar, Sidebar, Breadcrumbs, Footer as slot content.
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import Sidebar from '../../components/Sidebar';
import Breadcrumbs from '../../components/Breadcrumbs';
import Footer from '../../components/Footer';
import { usePageHeaderMounted } from '../../components/ui/PageHeader';
import { useKeyboardShortcuts, useKeyboardShortcutsEnabled } from '../../hooks/useKeyboardShortcuts';
import KeyboardShortcutsModal from '../../components/KeyboardShortcutsModal';
import AIChatPanel from '../../plugins/ai-assistance/components/AIChatPanel';

const aiAssistanceEnabled = true; // v1: hardcoded ON; runtime gate via plugin enabled flag.

const ShellLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { enabled: shortcutsEnabled } = useKeyboardShortcutsEnabled();
  const { showHelp, setShowHelp, gPending } = useKeyboardShortcuts(shortcutsEnabled);
  const [chatOpen, setChatOpen] = useState(false);
  const pageHasOwnHeader = usePageHeaderMounted();

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const toggleCollapse = () => setSidebarCollapsed(!sidebarCollapsed);

  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Reset before paint so navigation never briefly renders a shorter target at
  // the previous page's scroll offset. Reset the document as well as <main>:
  // older layouts and browser overflow can otherwise make window the scroll
  // owner, leaving the new page above the visible viewport.
  useLayoutEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
      mainRef.current.scrollLeft = 0;
    }
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }, [location.pathname, location.search]);

  // Left-nav width — drag the right edge to resize (desktop, when expanded); persisted.
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 480;
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('sdd-sidebar-width'));
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 240;
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizingSidebar(true);
    const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
    let latest = 0;
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(Math.max(ev.clientX - left, SIDEBAR_MIN), SIDEBAR_MAX);
      setSidebarWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      setResizingSidebar(false);
      if (latest) localStorage.setItem('sdd-sidebar-width', String(Math.round(latest)));
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ⌘K / Ctrl-K — global shortcut to open the AI chat composer. The
  // panel itself handles focus when already open; here we just open
  // it. Dispatched via window event so the panel doesn't need a
  // backref to the shell. (#126)
  useEffect(() => {
    const onOpenChat = () => setChatOpen(true);
    window.addEventListener('ai-chat:open', onOpenChat);
    return () => window.removeEventListener('ai-chat:open', onOpenChat);
  }, []);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-base-200">
      {/* Header slot */}
      <Navbar toggleSidebar={toggleSidebar} toggleChat={() => setChatOpen(o => !o)} chatOpen={chatOpen} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar slot */}
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          ref={sidebarRef}
          style={{ width: sidebarCollapsed ? undefined : sidebarWidth }}
          className={`fixed md:relative z-30 md:z-0 h-full transform ${resizingSidebar ? '' : 'transition-all duration-300 ease-in-out'} bg-surface-subtle border-r border-line ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } md:translate-x-0 ${sidebarCollapsed ? 'w-12' : ''}`}
        >
          {/* Right-edge drag handle — resize the expanded nav (desktop); persisted. */}
          {!sidebarCollapsed && (
            <div
              onMouseDown={startSidebarResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              title="Drag to resize"
              data-testid="sidebar-resize-handle"
              className="hidden md:block absolute right-0 top-0 bottom-0 w-1 -mr-0.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors z-20"
            />
          )}
          {/* Collapse toggle (desktop only) */}
          <button
            className="hidden md:flex absolute -right-3 top-3 z-10 btn btn-circle btn-xs bg-base-100 border border-base-300 shadow-sm hover:bg-base-200"
            onClick={toggleCollapse}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-3 w-3 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </button>
          <Sidebar collapsed={sidebarCollapsed} />
        </div>

        {/* Main content slot */}
        <main ref={mainRef} className="flex-1 overflow-auto flex flex-col px-4 md:px-5 pb-2" style={{ paddingTop: 5 }}>
          {!pageHasOwnHeader && <Breadcrumbs />}
          <div className="flex-1 min-h-0 flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Footer slot */}
      <Footer />

      {/* AI Chat Panel */}
      {aiAssistanceEnabled && <AIChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />}

      {/* Keyboard shortcuts help modal */}
      {showHelp && <KeyboardShortcutsModal onClose={() => setShowHelp(false)} />}

      {/* G-pending chord indicator */}
      {gPending && (
        <div className="fixed bottom-4 right-4 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg px-3 py-2 text-sm">
          <kbd className="kbd kbd-sm">G</kbd> pressed — waiting for <kbd className="kbd kbd-sm">H</kbd> <kbd className="kbd kbd-sm">D</kbd> <kbd className="kbd kbd-sm">Q</kbd>
        </div>
      )}
    </div>
  );
};

export default ShellLayout;
