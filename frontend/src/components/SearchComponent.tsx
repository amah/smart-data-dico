import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { servicesApi, stereotypeApi } from '../services/api';
import type { SearchResult, Stereotype } from '../types';

const TYPE_BADGES: Record<string, string> = {
  entity: 'badge-primary',
  attribute: 'badge-secondary',
  metadata: 'badge-accent',
  relationship: 'badge-info',
  package: 'badge-warning',
};

const SearchComponent = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    type: searchParams.get('type') || 'all',
    service: searchParams.get('service') || 'all',
    stereotype: searchParams.get('stereotype') || 'all',
    hasMetadata: searchParams.get('hasMetadata') || '',
  });
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);

  useEffect(() => {
    servicesApi.getAllServices().then((r) => setAvailableServices(r.data)).catch(() => {});
    stereotypeApi.getAll('entity').then(setStereotypes).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialQuery) performSearch(initialQuery);
  }, [initialQuery]);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) { setResults([]); return; }

    try {
      setLoading(true);
      setError(null);
      const backendFilters: any = {};
      if (filters.type !== 'all') backendFilters.type = filters.type;
      if (filters.service !== 'all') backendFilters.service = filters.service;
      if (filters.stereotype !== 'all') backendFilters.stereotype = filters.stereotype;
      if (filters.hasMetadata) backendFilters.hasMetadata = filters.hasMetadata;

      const response = await servicesApi.searchEntities(
        searchQuery,
        Object.keys(backendFilters).length > 0 ? backendFilters : undefined,
      );
      setResults(response.data);
    } catch (err) {
      setError('Failed to perform search.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params: any = { q: query };
    if (filters.type !== 'all') params.type = filters.type;
    if (filters.service !== 'all') params.service = filters.service;
    if (filters.stereotype !== 'all') params.stereotype = filters.stereotype;
    if (filters.hasMetadata) params.hasMetadata = filters.hasMetadata;
    setSearchParams(params);
    performSearch(query);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const highlightText = (text: string, term: string) => {
    if (!term.trim()) return text;
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-primary/30">{part}</mark> : part,
    );
  };

  const getResultLink = (result: SearchResult) => {
    if (result.type === 'package') return `/packages/${result.service}`;
    if (result.type === 'relationship') return `/packages/${result.service}`;
    return `/packages/${result.service}/entities/${result.entityName}`;
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-6">Search Data Dictionary</h2>

        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-4">
            <div className="form-control flex-1">
              <div className="join w-full">
                <input
                  type="text"
                  placeholder="Search entities, attributes, metadata, relationships..."
                  className="input input-bordered join-item w-full"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="submit" className="btn btn-primary join-item">Search</button>
              </div>
            </div>
          </div>
        </form>

        {/* Facet Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="form-control">
            <select
              className="select select-bordered select-sm"
              value={filters.type}
              onChange={(e) => handleFilterChange('type', e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="entity">Entities</option>
              <option value="attribute">Attributes</option>
              <option value="metadata">Metadata</option>
              <option value="relationship">Relationships</option>
              <option value="package">Packages</option>
            </select>
          </div>

          <div className="form-control">
            <select
              className="select select-bordered select-sm"
              value={filters.service}
              onChange={(e) => handleFilterChange('service', e.target.value)}
            >
              <option value="all">All Services</option>
              {availableServices.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-control">
            <select
              className="select select-bordered select-sm"
              value={filters.stereotype}
              onChange={(e) => handleFilterChange('stereotype', e.target.value)}
            >
              <option value="all">All Stereotypes</option>
              {stereotypes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="form-control">
            <input
              type="text"
              className="input input-bordered input-sm w-40"
              placeholder="Has metadata..."
              value={filters.hasMetadata}
              onChange={(e) => handleFilterChange('hasMetadata', e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <span className="loading loading-spinner loading-lg" />
          </div>
        ) : error ? (
          <div className="alert alert-error"><span>{error}</span></div>
        ) : results.length === 0 && initialQuery ? (
          <div className="alert alert-info">
            <span>No results found for "{initialQuery}". Try a different search term or adjust filters.</span>
          </div>
        ) : results.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Service</th>
                  <th>Description</th>
                  <th>Context</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={index} className="hover">
                    <td>
                      <span className={`badge badge-sm ${TYPE_BADGES[result.type] || 'badge-ghost'}`}>
                        {result.type}
                      </span>
                    </td>
                    <td className="font-mono font-medium">{highlightText(result.name, query)}</td>
                    <td><span className="badge badge-ghost badge-sm">{result.service}</span></td>
                    <td className="max-w-xs truncate text-sm">{highlightText(result.description, query)}</td>
                    <td className="text-xs text-base-content/60">{result.matchContext || ''}</td>
                    <td>
                      <Link to={getResultLink(result)} className="btn btn-xs btn-ghost">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {results.length > 0 && (
          <div className="mt-4 text-sm text-base-content/70">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchComponent;
