import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';

interface ForgotPasswordFormData {
  email: string;
}

const ForgotPassword = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordFormData>({
    defaultValues: {
      email: ''
    }
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      
      // In a real application, you would call an API endpoint to send a password reset email
      // For now, we'll just simulate a successful request
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSuccess(`Password reset instructions have been sent to ${data.email}`);
    } catch (err: any) {
      console.error('Password reset error:', err);
      setError(err.response?.data?.message || 'Failed to send password reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title text-2xl mb-6 justify-center">Forgot Password</h2>
          
          {error && (
            <div className="alert alert-error mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}
          
          {success ? (
            <div className="text-center">
              <div className="alert alert-success mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{success}</span>
              </div>
              
              <p className="mb-6">
                Please check your email for instructions on how to reset your password.
              </p>
              
              <div className="flex justify-center">
                <Link to="/login" className="btn btn-primary">
                  Return to Login
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-6">
                Enter your email address and we'll send you instructions to reset your password.
              </p>
              
              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="form-control">
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
                
                <div className="form-control mt-6">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Sending...
                      </>
                    ) : (
                      'Send Reset Instructions'
                    )}
                  </button>
                </div>
              </form>
              
              <div className="text-center mt-6">
                <p className="text-sm">
                  Remember your password?{' '}
                  <Link to="/login" className="link link-primary">
                    Login
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;