import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authApi } from '../services/api';
import { User } from '../types';
import { useAppMode } from '../hooks/useAppMode';

interface AuthGuardProps {
  children: ReactNode;
  roles?: string[];
}

const AuthGuard = ({ children, roles }: AuthGuardProps) => {
  const { mode } = useAppMode();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (!authApi.isAuthenticated()) {
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }

        // Get current user data
        const response = await authApi.getCurrentUser();
        setUser(response.data);
        setIsAuthenticated(true);
      } catch (err) {
        console.error('Authentication check failed:', err);
        setIsAuthenticated(false);
        // Clear token if it's invalid
        authApi.logout();
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Desktop mode: always pass through, no auth needed
  if (mode === 'desktop') {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role-based access if roles are specified
  if (roles && user && !roles.includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="alert alert-error max-w-md">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="font-bold">Access Denied</h3>
            <div className="text-sm">You don't have permission to access this page.</div>
          </div>
        </div>
        <button 
          className="btn btn-primary mt-4"
          onClick={() => window.history.back()}
        >
          Go Back
        </button>
      </div>
    );
  }

  // Authenticated and authorized
  return <>{children}</>;
};

export default AuthGuard;