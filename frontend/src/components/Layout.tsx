import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { usePageHeaderMounted } from './ui/PageHeader';

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageHasOwnHeader = usePageHeaderMounted();

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="flex flex-col min-h-screen bg-base-100">
      <Navbar toggleSidebar={toggleSidebar} />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - hidden on mobile unless toggled */}
        <div 
          className={`
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
            md:translate-x-0 fixed md:relative z-10 w-64 h-[calc(100vh-4rem)] 
            transition-transform duration-300 ease-in-out
            bg-base-200 shadow-lg overflow-y-auto
          `}
        >
          <Sidebar />
        </div>
        
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Breadcrumbs — compact strip; hidden when the page owns a PageHeader */}
          {!pageHasOwnHeader && (
            <div className="bg-base-200 px-4 py-1">
              <Breadcrumbs />
            </div>
          )}

          {/* Page content */}
          {/* flex column down to the page so full-height pages (diagram
              canvas) can flex-1 to the available space; normal pages still
              stack and scroll via main's overflow-auto. */}
          <main className="flex-1 overflow-auto px-4 md:px-5 py-2 flex flex-col">
            <div className="container mx-auto flex flex-col flex-1">
              <Outlet />
            </div>
          </main>
          
          <Footer />
        </div>
      </div>
      
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-0"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default Layout;