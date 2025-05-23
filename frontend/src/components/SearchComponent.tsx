import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { servicesApi } from '../services/api';
import { SearchResult } from '../types';

const SearchComponent = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    type: 'all', // 'all', 'entity', 'attribute', 'relationship'
    service: 'all'
  });
  const [availableServices, setAvailableServices] = useState<string[]>([]);

  // Fetch available services for filtering
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await servicesApi.getAllServices();
        setAvailableServices(response.data);
      } catch (err) {
        console.error('Error fetching services for search filters:', err);
      }
    };

    fetchServices();
  }, []);

  // Perform search when query changes from URL
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery);
    }
  }, [initialQuery]);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await servicesApi.searchEntities(searchQuery);
      setResults(response.data);
    } catch (err) {
      console.error('Error performing search:', err);
      setError('Failed to perform search. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams({ q: query });
    performSearch(query);
  };

  const handleFilterChange = (filterType: 'type' | 'service', value: string) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: value
    }));
  };

  // Apply filters to results
  const filteredResults = results.filter(result => {
    const matchesType = filters.type === 'all' || result.type === filters.type;
    const matchesService = filters.service === 'all' || result.microservice === filters.service;
    return matchesType && matchesService;
  });

  // Highlight search terms in text
  const highlightText = (text: string, term: string) => {
    if (!term.trim()) return text;
    
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      regex.test(part) ? <mark key={i} className="bg-primary/30">{part}</mark> : part
    );
  };

  // Get icon for result type
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'entity':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        );
      case 'attribute':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'relationship':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-6">Search Data Dictionary</h2>

        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="form-control flex-1">
              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="Search for entities, attributes, or relationships..." 
                  className="input input-bordered w-full"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                  Search
                </button>
              </div>
            </div>
          </div>
        </form>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Filter by Type</span>
            </label>
            <select 
              className="select select-bordered"
              value={filters.type}
              onChange={(e) => handleFilterChange('type', e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="entity">Entities</option>
              <option value="attribute">Attributes</option>
              <option value="relationship">Relationships</option>
            </select>
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Filter by Service</span>
            </label>
            <select 
              className="select select-bordered"
              value={filters.service}
              onChange={(e) => handleFilterChange('service', e.target.value)}
            >
              <option value="all">All Services</option>
              {availableServices.map(service => (
                <option key={service} value={service}>{service}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : error ? (
          <div className="alert alert-error">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        ) : filteredResults.length === 0 && initialQuery ? (
          <div className="alert alert-info">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>No results found for "{initialQuery}". Try a different search term.</span>
          </div>
        ) : filteredResults.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Service</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((result, index) => (
                  <tr key={index} className="hover">
                    <td>
                      <div className="flex items-center gap-2">
                        {getTypeIcon(result.type)}
                        <span className="capitalize">{result.type}</span>
                      </div>
                    </td>
                    <td className="font-medium">{highlightText(result.name, query)}</td>
                    <td>{result.microservice}</td>
                    <td className="max-w-xs truncate">{highlightText(result.description, query)}</td>
                    <td>
                      <Link 
                        to={`/services/${result.microservice}/entities/${result.entityName}`}
                        className="btn btn-sm btn-ghost"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {filteredResults.length > 0 && (
          <div className="mt-4 text-sm text-base-content/70">
            Found {filteredResults.length} {filteredResults.length === 1 ? 'result' : 'results'}
            {results.length !== filteredResults.length && ` (filtered from ${results.length})`}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchComponent;