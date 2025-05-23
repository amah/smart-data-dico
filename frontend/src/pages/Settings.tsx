import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { authApi } from '../services/api';
import { User } from '../types';

interface SettingsFormData {
  theme: string;
  notifications: boolean;
  emailNotifications: boolean;
  autoCommit: boolean;
  defaultView: string;
}

const Settings = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<SettingsFormData>({
    defaultValues: {
      theme: 'system',
      notifications: true,
      emailNotifications: true,
      autoCommit: false,
      defaultView: 'list'
    }
  });

  useEffect(() => {
    const fetchUserSettings = async () => {
      try {
        setLoading(true);
        const response = await authApi.getCurrentUser();
        setUser(response.data);
        
        // In a real application, you would fetch user settings from the API
        // For now, we'll just use default values
        reset({
          theme: 'system',
          notifications: true,
          emailNotifications: true,
          autoCommit: false,
          defaultView: 'list'
        });
      } catch (err) {
        console.error('Error fetching user settings:', err);
        setError('Failed to load user settings');
      } finally {
        setLoading(false);
      }
    };

    fetchUserSettings();
  }, [reset]);

  const onSubmit = async (data: SettingsFormData) => {
    try {
      setUpdateLoading(true);
      setError(null);
      setSuccess(null);
      
      // In a real application, you would call an API endpoint to update the user settings
      // For now, we'll just simulate a successful update
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSuccess('Settings updated successfully');
      
      // Apply theme change
      if (data.theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else if (data.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        // System theme
        document.documentElement.removeAttribute('data-theme');
      }
    } catch (err: any) {
      console.error('Settings update error:', err);
      setError(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setUpdateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      
      {error && (
        <div className="alert alert-error mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}
      
      {success && (
        <div className="alert alert-success mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{success}</span>
        </div>
      )}
      
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Appearance Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4">Appearance</h2>
              </div>
              
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Theme</span>
                </label>
                <select 
                  className="select select-bordered w-full"
                  {...register('theme')}
                >
                  <option value="system">System Default</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Default View</span>
                </label>
                <select 
                  className="select select-bordered w-full"
                  {...register('defaultView')}
                >
                  <option value="list">List View</option>
                  <option value="grid">Grid View</option>
                  <option value="table">Table View</option>
                </select>
              </div>
              
              {/* Notification Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Notifications</h2>
              </div>
              
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    {...register('notifications')}
                  />
                  <div>
                    <span className="label-text font-medium">In-app Notifications</span>
                    <p className="text-xs opacity-70 mt-1">
                      Receive notifications within the application
                    </p>
                  </div>
                </label>
              </div>
              
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    {...register('emailNotifications')}
                  />
                  <div>
                    <span className="label-text font-medium">Email Notifications</span>
                    <p className="text-xs opacity-70 mt-1">
                      Receive notifications via email
                    </p>
                  </div>
                </label>
              </div>
              
              {/* Data Dictionary Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Data Dictionary</h2>
              </div>
              
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    {...register('autoCommit')}
                  />
                  <div>
                    <span className="label-text font-medium">Auto-commit Changes</span>
                    <p className="text-xs opacity-70 mt-1">
                      Automatically commit changes when editing entities
                    </p>
                  </div>
                </label>
              </div>
              
              {/* Account Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Account</h2>
                
                <div className="flex flex-col gap-2">
                  <button 
                    type="button" 
                    className="btn btn-outline btn-error w-full md:w-auto"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                        // In a real application, you would call an API endpoint to delete the account
                        console.log('Delete account');
                      }
                    }}
                  >
                    Delete Account
                  </button>
                  
                  <p className="text-xs opacity-70">
                    This will permanently delete your account and all associated data.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="card-actions justify-end mt-8">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={updateLoading}
              >
                {updateLoading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Saving...
                  </>
                ) : (
                  'Save Settings'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Settings;