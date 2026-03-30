import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { importExportApi } from '../services/api';

interface EntityQuality {
  name: string;
  uuid: string;
  descriptionFilled: boolean;
  attributeDescriptionRate: number;
  stereotypeCompliant: boolean;
  hasRelationships: boolean;
  score: number;
}

interface PackageQuality {
  name: string;
  entityCount: number;
  descriptionCoverage: number;
  metadataCoverage: number;
  relationshipCoverage: number;
  overallScore: number;
  entities: EntityQuality[];
}

interface QualityReport {
  overall: number;
  totalEntities: number;
  totalAttributes: number;
  packages: PackageQuality[];
}

const scoreColor = (score: number) => {
  if (score >= 80) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-error';
};

const scoreBadge = (score: number) => {
  if (score >= 80) return 'badge-success';
  if (score >= 50) return 'badge-warning';
  return 'badge-error';
};

export default function QualityDashboardPage() {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);

  useEffect(() => {
    importExportApi.getQualityReport()
      .then(setReport)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  if (!report) {
    return <div className="p-6"><div className="alert alert-error">Failed to load quality report.</div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quality Dashboard</h1>
        <p className="text-base-content/70">Track documentation completeness across your data dictionary.</p>
      </div>

      {/* Overall stats */}
      <div className="stats shadow w-full">
        <div className="stat">
          <div className="stat-title">Overall Score</div>
          <div className={`stat-value ${scoreColor(report.overall)}`}>{report.overall}%</div>
        </div>
        <div className="stat">
          <div className="stat-title">Packages</div>
          <div className="stat-value text-lg">{report.packages.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Total Entities</div>
          <div className="stat-value text-lg">{report.totalEntities}</div>
        </div>
      </div>

      {/* Per-package breakdown */}
      <div className="space-y-3">
        {report.packages.map((pkg) => (
          <div key={pkg.name} className="card bg-base-200">
            <div className="card-body p-4">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedPkg(expandedPkg === pkg.name ? null : pkg.name)}
              >
                <div className="flex items-center gap-3">
                  <Link to={`/packages/${pkg.name}`} className="font-bold text-lg link link-hover" onClick={e => e.stopPropagation()}>
                    {pkg.name}
                  </Link>
                  <span className={`badge ${scoreBadge(pkg.overallScore)}`}>{pkg.overallScore}%</span>
                  <span className="text-sm text-base-content/60">{pkg.entityCount} entities</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <span title="Description coverage">Desc: {pkg.descriptionCoverage}%</span>
                  <span title="Metadata compliance">Meta: {pkg.metadataCoverage}%</span>
                  <span title="Relationship coverage">Rels: {pkg.relationshipCoverage}%</span>
                  <span className="text-base-content/40">{expandedPkg === pkg.name ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedPkg === pkg.name && (
                <div className="mt-3 overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Description</th>
                        <th>Attr Descriptions</th>
                        <th>Stereotype</th>
                        <th>Relationships</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pkg.entities.map((e) => (
                        <tr key={e.uuid}>
                          <td>
                            <Link to={`/packages/${pkg.name}/entities/${e.name}`} className="link link-primary font-mono">
                              {e.name}
                            </Link>
                          </td>
                          <td>{e.descriptionFilled ? <span className="text-success">Yes</span> : <span className="text-error">Missing</span>}</td>
                          <td>{e.attributeDescriptionRate}%</td>
                          <td>{e.stereotypeCompliant ? <span className="text-success">OK</span> : <span className="text-warning">Incomplete</span>}</td>
                          <td>{e.hasRelationships ? <span className="text-success">Yes</span> : <span className="text-error">None</span>}</td>
                          <td><span className={`badge badge-sm ${scoreBadge(e.score)}`}>{e.score}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
