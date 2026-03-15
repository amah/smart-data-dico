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

const ShellLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const toggleCollapse = () => setSidebarCollapsed(!sidebarCollapsed);

  return (
    <div className="min-h-screen flex flex-col bg-base-200">
      {/* Header slot */}
      <Navbar toggleSidebar={toggleSidebar} />

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
          className={`fixed md:relative z-30 md:z-0 h-full transform transition-all duration-300 ease-in-out bg-base-100 border-r border-base-300 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } md:translate-x-0 ${sidebarCollapsed ? 'w-14' : 'w-56'}`}
        >
          {/* Collapse toggle (desktop only) */}
          <button
            className="hidden md:flex absolute -right-3 top-4 z-10 btn btn-circle btn-xs bg-base-100 border border-base-300 shadow-sm hover:bg-base-200"
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
        <main className="flex-1 overflow-auto flex flex-col">
          <div className="px-4 md:px-6 pt-3">
            <Breadcrumbs />
          </div>
          <div className="flex-1 px-4 md:px-6 pb-4 pt-2 min-h-0 flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Footer slot */}
      <Footer />
    </div>
  );
};

export default ShellLayout;
