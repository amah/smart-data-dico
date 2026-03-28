import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import CytoscapeGraph from '../components/CytoscapeGraph';
import { servicesApi } from '../services/api';

const EntityDiagramPage: React.FC = () => {
  const { service } = useParams<{ service?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [services, setServices] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<string>(service || '');
  const initialLayoutId = searchParams.get('layout') || undefined;

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await servicesApi.getAllServices();
        const serviceList = response.data || response;
        setServices(serviceList);
      } catch (err) {
        console.error('Error fetching services:', err);
      }
    };
    fetchServices();
  }, []);

  const handleServiceChange = (newService: string) => {
    setSelectedService(newService);
    if (newService) {
      navigate(`/diagram/${newService}`);
    } else {
      navigate('/diagram');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-base-200 border-b border-base-300 px-4 py-2">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">Entity Graph</h1>
            <p className="text-xs text-base-content/70">
              Interactive entity relationship graph
            </p>
          </div>
          <div className="form-control">
            <select
              className="select select-bordered select-sm"
              value={selectedService}
              onChange={(e) => handleServiceChange(e.target.value)}
            >
              <option value="">All Services</option>
              {services.map((svc) => (
                <option key={svc} value={svc}>
                  {svc}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 min-h-0">
        <CytoscapeGraph
          service={selectedService || undefined}
          mode="service"
          initialLayoutId={initialLayoutId}
        />
      </div>
    </div>
  );
};

export default EntityDiagramPage;
