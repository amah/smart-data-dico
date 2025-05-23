import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';

interface NavbarProps {
  toggleSidebar: () => void;
}

const Navbar = ({ toggleSidebar }: NavbarProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState(authApi.isAuthenticated());
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = () => {
    authApi.logout();
    setIsAuthenticated(false);
    navigate('/login');
  };

  return (
    <div className="navbar bg-primary text-primary-content shadow-md">
      <div className="navbar-start">
        {/* Mobile sidebar toggle */}
        <button 
          className="btn btn-ghost btn-circle md:hidden"
          onClick={toggleSidebar}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
        
        {/* Logo */}
        <Link to="/" className="btn btn-ghost normal-case text-xl">
          Data Dictionary
        </Link>
      </div>
      
      <div className="navbar-center hidden lg:flex">
        {/* Desktop navigation */}
        <ul className="menu menu-horizontal px-1">
          <li><Link to="/services">Services</Link></li>
          <li><Link to="/visualization">Visualization</Link></li>
          <li><Link to="/diagram">Diagram Editor</Link></li>
          <li><Link to="/version/history">History</Link></li>
        </ul>
      </div>
      
      <div className="navbar-end">
        {/* Search */}
        <form onSubmit={handleSearch} className="hidden md:flex">
          <div className="form-control">
            <div className="input-group">
              <input 
                type="text" 
                placeholder="Search..." 
                className="input input-sm input-bordered text-base-content"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-sm btn-square">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </div>
        </form>
        
        {/* Mobile search button */}
        <Link to="/search" className="btn btn-ghost btn-circle md:hidden">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </Link>
        
        {/* User menu */}
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle avatar">
            <div className="w-10 rounded-full bg-primary-focus flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </label>
          <ul tabIndex={0} className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52 text-base-content">
            {isAuthenticated ? (
              <>
                <li>
                  <Link to="/profile" className="justify-between">
                    Profile
                    <span className="badge">New</span>
                  </Link>
                </li>
                <li><Link to="/settings">Settings</Link></li>
                <li><button onClick={handleLogout}>Logout</button></li>
              </>
            ) : (
              <>
                <li><Link to="/login">Login</Link></li>
                <li><Link to="/register">Register</Link></li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Navbar;