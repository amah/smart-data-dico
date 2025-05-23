import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { servicesApi } from '../services/api';

const ServiceList = () => {
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        setLoading(true);
        const response = await servicesApi.getAllServices();
        setServices(response.data);
        setError(null);
      } catch (err) {
        console.error('Error fetching services:', err);
        setError('Failed to load services. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{error}</span>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="alert alert-info">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>No services found. Create a new service to get started.</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {services.map((service) => (
        <div key={service} className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow">
          <div className="card-body">
            <h2 className="card-title">{service}</h2>
            <p className="text-sm opacity-70">Microservice</p>
            <div className="card-actions justify-end mt-4">
              <Link to={`/services/${service}`} className="btn btn-primary">
                View Entities
              </Link>
            </div>
          </div>
        </div>
      ))}
      
      {/* Add new service card */}
      <div className="card bg-base-100 shadow-xl border-2 border-dashed border-base-300 hover:border-primary hover:shadow-2xl transition-all">
        <div className="card-body items-center text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <h2 className="card-title mt-2">Add New Service</h2>
          <p className="text-sm opacity-70">Create a new microservice</p>
          <div className="card-actions mt-4">
            <Link to="/services/create" className="btn btn-outline btn-primary">
              Create Service
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceList;