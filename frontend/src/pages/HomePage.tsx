import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { servicesApi, entityApi } from '../services/api'

const HomePage = () => {
  const [stats, setStats] = useState({ services: 0, entities: 0, packages: 0 });
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [servicesRes, packagesRes] = await Promise.all([
          servicesApi.getAllServices(),
          entityApi.getAllPackages(),
        ]);
        const serviceList = servicesRes.data || [];
        const packageList = packagesRes || [];
        const entityCount = packageList.reduce(
          (sum: number, pkg: { entities?: unknown[] }) => sum + (pkg.entities?.length || 0),
          0
        );
        setServices(serviceList);
        setStats({
          services: serviceList.length,
          packages: packageList.length,
          entities: entityCount,
        });
      } catch (err) {
        console.error('Error fetching stats:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      {/* Compact hero */}
      <div className="bg-base-100 rounded-lg p-6 shadow">
        <h1 className="text-3xl font-bold">Data Dictionary</h1>
        <p className="text-base-content/70 mt-1">
          Manage data dictionaries across your organization.
        </p>
        <div className="flex gap-3 mt-4">
          <Link to="/services" className="btn btn-primary btn-sm">
            Browse Services
          </Link>
          <Link to="/visualization" className="btn btn-outline btn-sm">
            View Diagram
          </Link>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Services</div>
          <div className="stat-value text-primary">
            {loading ? <span className="loading loading-spinner loading-sm"></span> : stats.services}
          </div>
          <div className="stat-desc">Microservices tracked</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Entities</div>
          <div className="stat-value text-secondary">
            {loading ? <span className="loading loading-spinner loading-sm"></span> : stats.entities}
          </div>
          <div className="stat-desc">Across all packages</div>
        </div>
        <div className="stat bg-base-100 rounded-lg shadow">
          <div className="stat-title">Packages</div>
          <div className="stat-value text-accent">
            {loading ? <span className="loading loading-spinner loading-sm"></span> : stats.packages}
          </div>
          <div className="stat-desc">Logical groupings</div>
        </div>
      </div>

      {/* Quick access - services list */}
      <div className="bg-base-100 rounded-lg shadow p-5">
        <h2 className="text-lg font-semibold mb-3">Services</h2>
        {loading ? (
          <div className="flex justify-center p-4">
            <span className="loading loading-spinner loading-md"></span>
          </div>
        ) : services.length === 0 ? (
          <p className="text-base-content/60 text-sm">No services found. Create your first service to get started.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map((service) => (
              <Link
                key={service}
                to={`/services/${service}`}
                className="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer"
              >
                <div className="card-body p-4">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">{service}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default HomePage
