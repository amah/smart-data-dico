/**
 * ShellLayout
 *
 * Adapts the current Layout.tsx to work within the shell plugin system.
 * Renders existing Navbar, Sidebar, Breadcrumbs, Footer as slot content.
 * This is a thin wrapper — no component rewrites.
 */

import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import Sidebar from '../../components/Sidebar';
import Breadcrumbs from '../../components/Breadcrumbs';
import Footer from '../../components/Footer';

const ShellLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

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
          className={`fixed md:relative z-30 md:z-0 w-64 h-full transform transition-transform duration-300 ease-in-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } md:translate-x-0`}
        >
          <Sidebar />
        </div>

        {/* Main content slot */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Breadcrumbs />
          <div className="mt-4">
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
