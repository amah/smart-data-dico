import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { authApi } from '../services/api';
import { User } from '../types';

interface ProfileFormData {
  username: string;
  email: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const Profile = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [changePassword, setChangePassword] = useState(false);
  
  const { register, handleSubmit, formState: { errors }, reset, watch } = useForm<ProfileFormData>();
  
  const newPassword = watch('newPassword');

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        setLoading(true);
        const response = await authApi.getCurrentUser();
        setUser(response.data);
        
        // Initialize form with user data
        reset({
          username: response.data.username,
          email: response.data.email,
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
      } catch (err) {
        console.error('Error fetching user profile:', err);
        setError('Failed to load user profile');
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [reset]);

  const onSubmit = async (data: ProfileFormData) => {
    try {
      setUpdateLoading(true);
      setError(null);
      setSuccess(null);
      
      // In a real application, you would call an API endpoint to update the user profile
      // For now, we'll just simulate a successful update
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update local user state
      setUser(prev => {
        if (!prev) return null;
        return {
          ...prev,
          username: data.username,
          email: data.email
        };
      });
      
      setSuccess('Profile updated successfully');
    } catch (err: any) {
      console.error('Profile update error:', err);
      setError(err.response?.data?.message || 'Failed to update profile');
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

  if (!user) {
    return (
      <div className="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Failed to load user profile</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">User Profile</h1>
      
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
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body items-center text-center">
              <div className="avatar placeholder">
                <div className="bg-primary text-primary-content rounded-full w-24">
                  <span className="text-3xl">{user.username.charAt(0).toUpperCase()}</span>
                </div>
              </div>
              <h2 className="card-title mt-4">{user.username}</h2>
              <p className="text-sm opacity-70">{user.email}</p>
              <div className="badge badge-primary mt-2">{user.role}</div>
            </div>
          </div>
        </div>
        
        <div className="md:col-span-2">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-xl mb-4">Edit Profile</h2>
              
              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Username</span>
                  </label>
                  <input
                    type="text"
                    className={`input input-bordered ${errors.username ? 'input-error' : ''}`}
                    {...register('username', { required: 'Username is required' })}
                  />
                  {errors.username && (
                    <label className="label">
                      <span className="label-text-alt text-error">{errors.username.message}</span>
                    </label>
                  )}
                </div>
                
                <div className="form-control mt-4">
                  <label className="label">
                    <span className="label-text">Email</span>
                  </label>
                  <input
                    type="email"
                    className={`input input-bordered ${errors.email ? 'input-error' : ''}`}
                    {...register('email', { 
                      required: 'Email is required',
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: 'Invalid email address'
                      }
                    })}
                  />
                  {errors.email && (
                    <label className="label">
                      <span className="label-text-alt text-error">{errors.email.message}</span>
                    </label>
                  )}
                </div>
                
                <div className="divider"></div>
                
                <div className="form-control">
                  <label className="label cursor-pointer justify-start gap-2">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={changePassword}
                      onChange={() => setChangePassword(!changePassword)}
                    />
                    <span className="label-text">Change Password</span>
                  </label>
                </div>
                
                {changePassword && (
                  <>
                    <div className="form-control mt-4">
                      <label className="label">
                        <span className="label-text">Current Password</span>
                      </label>
                      <input
                        type="password"
                        className={`input input-bordered ${errors.currentPassword ? 'input-error' : ''}`}
                        {...register('currentPassword', { 
                          required: 'Current password is required'
                        })}
                      />
                      {errors.currentPassword && (
                        <label className="label">
                          <span className="label-text-alt text-error">{errors.currentPassword.message}</span>
                        </label>
                      )}
                    </div>
                    
                    <div className="form-control mt-4">
                      <label className="label">
                        <span className="label-text">New Password</span>
                      </label>
                      <input
                        type="password"
                        className={`input input-bordered ${errors.newPassword ? 'input-error' : ''}`}
                        {...register('newPassword', { 
                          required: 'New password is required',
                          minLength: {
                            value: 8,
                            message: 'Password must be at least 8 characters'
                          }
                        })}
                      />
                      {errors.newPassword && (
                        <label className="label">
                          <span className="label-text-alt text-error">{errors.newPassword.message}</span>
                        </label>
                      )}
                    </div>
                    
                    <div className="form-control mt-4">
                      <label className="label">
                        <span className="label-text">Confirm New Password</span>
                      </label>
                      <input
                        type="password"
                        className={`input input-bordered ${errors.confirmPassword ? 'input-error' : ''}`}
                        {...register('confirmPassword', { 
                          required: 'Please confirm your new password',
                          validate: value => value === newPassword || 'Passwords do not match'
                        })}
                      />
                      {errors.confirmPassword && (
                        <label className="label">
                          <span className="label-text-alt text-error">{errors.confirmPassword.message}</span>
                        </label>
                      )}
                    </div>
                  </>
                )}
                
                <div className="card-actions justify-end mt-6">
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
                      'Save Changes'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;