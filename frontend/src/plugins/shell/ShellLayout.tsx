/**
 * ShellLayout
 *
 * Adapts the current Layout.tsx to work within the shell plugin system.
 * Renders existing Navbar, Sidebar, Breadcrumbs, Footer as slot content.
 */

import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import Sidebar from '../../components/Sidebar';
import Breadcrumbs from '../../components/Breadcrumbs';
import Footer from '../../components/Footer';
import { usePageHeaderMounted } from '../../components/ui/PageHeader';
import { useKeyboardShortcuts, useKeyboardShortcutsEnabled } from '../../hooks/useKeyboardShortcuts';
import KeyboardShortcutsModal from '../../components/KeyboardShortcutsModal';
import AIChatPanel from '../../components/AIChatPanel';

const ShellLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { enabled: shortcutsEnabled } = useKeyboardShortcutsEnabled();
  const { showHelp, setShowHelp, gPending } = useKeyboardShortcuts(shortcutsEnabled);
  const [chatOpen, setChatOpen] = useState(false);
  const pageHasOwnHeader = usePageHeaderMounted();

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const toggleCollapse = () => setSidebarCollapsed(!sidebarCollapsed);

  return (
    <div className="min-h-screen flex flex-col bg-base-200">
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
          className={`fixed md:relative z-30 md:z-0 h-full transform transition-all duration-300 ease-in-out bg-surface-subtle border-r border-line ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } md:translate-x-0 ${sidebarCollapsed ? 'w-12' : 'w-60'}`}
        >
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
        <main className="flex-1 overflow-auto flex flex-col px-4 md:px-5 pt-0 pb-2">
          {!pageHasOwnHeader && <Breadcrumbs />}
          <div className="flex-1 min-h-0 flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Footer slot */}
      <Footer />

      {/* AI Chat Panel */}
      <AIChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

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
