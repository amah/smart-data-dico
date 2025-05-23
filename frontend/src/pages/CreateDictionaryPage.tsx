import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dictionaryApi } from '../services/api';

const CreateDictionaryPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    version: '1.0.0'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await dictionaryApi.createDictionary(formData);
      console.log('Dictionary created:', response);
      navigate('/dictionaries');
    } catch (err: any) {
      console.error('Error creating dictionary:', err);
      setError(err.response?.data?.message || 'Failed to create dictionary');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Create New Dictionary</h1>
      
      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="card bg-base-100 shadow-xl p-6">
        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Dictionary Name</span>
          </label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="input input-bordered"
            required
          />
        </div>
        
        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Description</span>
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            className="textarea textarea-bordered"
            rows={3}
          />
        </div>
        
        <div className="form-control mb-6">
          <label className="label">
            <span className="label-text">Version</span>
          </label>
          <input
            type="text"
            name="version"
            value={formData.version}
            onChange={handleChange}
            className="input input-bordered"
          />
        </div>
        
        <div className="form-control">
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Create Dictionary'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateDictionaryPage;