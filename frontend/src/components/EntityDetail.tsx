import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { servicesApi, relationshipApi, stereotypeApi, actionsApi, stateMachinesApi } from '../services/api';
import { Entity, Relationship, Stereotype, ImpactAnalysis, Rule, Action, StateMachine } from '../types';
import ReviewComments from './ReviewComments';
import LineageView from './LineageView';
import MetadataEditor from './MetadataEditor';
import AttributeList from './AttributeList';
import RelationshipList from './RelationshipList';
import EntityRulesList from '../plugins/data-dictionary/components/rules/EntityRulesList';
import { EntityActionsTab } from '../plugins/data-dictionary/components/actions/EntityActionsTab';
import { EntityStateMachinesTab } from '../plugins/data-dictionary/components/state-machines/EntityStateMachinesTab';
import { useService } from '../kernel/useService';
import { RULE_SERVICE_TOKEN } from '../kernel/tokens';
import type { RuleService } from '../plugins/data-dictionary/services/RuleService';
import { Button, Chip, EmptyState, Icon, PageHeader } from './ui';
import Breadcrumbs from './Breadcrumbs';

/**
 * Entity detail page — Phase 4.1 redesign.
 *
 * Grammar (Shell + Entity, see /design-system):
 *   - breadcrumb strip (home > packages > service > entity)
 *   - entity header: name in mono fs-2xl, bounded-context chip, counts
 *   - action cluster on the right (Clone / Visualize / Edit / status actions)
 *   - tabs: 8px 12px padding, 2px accent bottom border when active
 *
 * This is chrome only — every backend call, rule-fetch, and child-tab
 * component is preserved from the pre-redesign version.
 */

interface EntityDetailProps {
  serviceProp?: string;
  entityProp?: string;
  packagePath?: string[];
  editMode?: boolean;
}

type TabId = 'attributes' | 'relationships' | 'metadata' | 'lineage' | 'impact' | 'comments' | 'rules' | 'actions' | 'state-machines';

interface TabDef {
  id: TabId;
  label: string;
  count?: number;
}

const EntityDetail = (props: EntityDetailProps) => {
  const ruleService = useService<RuleService>(RULE_SERVICE_TOKEN);
  const params = useParams<{ service: string; entity: string }>();
  const service = props.serviceProp || params.service;
  const entity = props.entityProp || params.entity;
  const [entityData, setEntityData] = useState<Entity | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('attributes');
  const [impact, setImpact] = useState<ImpactAnalysis | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityDescription, setNewEntityDescription] = useState('');
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [currentStereotype, setCurrentStereotype] = useState<Stereotype | null>(null);
  const [entityRules, setEntityRules] = useState<Rule[]>([]);
  const [entityActions, setEntityActions] = useState<Action[]>([]);
  const [entityStateMachines, setEntityStateMachines] = useState<StateMachine[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    stereotypeApi.getAll('entity').then(setStereotypes).catch(() => {});
  }, []);

  const fetchEntityData = useCallback(async (showLoader = true) => {
    if (!service || !entity) return;
    try {
      if (showLoader) setLoading(true);
      const response = await servicesApi.getEntitySchema(service, entity);
      setEntityData(response.data);

      if (response.data?.stereotype) {
        try {
          const st = await stereotypeApi.getById(response.data.stereotype);
          setCurrentStereotype(st);
        } catch { /* ok */ }
      }

      try {
        const rels = await relationshipApi.getPackageRelationships(service);
        const entityUuid = response.data?.uuid;
        if (entityUuid) {
          setRelationships(rels.filter(
            (r: Relationship) => r.source.entity === entityUuid || r.target.entity === entityUuid
          ));
        }
      } catch {
        setRelationships([]);
      }

      setError(null);
    } catch (err) {
      console.error(`Error fetching entity ${entity} for service ${service}:`, err);
      setError('Failed to load entity details. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [service, entity]);

  useEffect(() => {
    const isCreatePath = window.location.pathname.endsWith('/create');
    if (entity === 'create' || (isCreatePath && !entity)) {
      setIsCreateMode(true);
      setLoading(false);
      return;
    }
    fetchEntityData();
  }, [service, entity]);

  const fetchEntityRules = useCallback(async () => {
    if (!entityData?.uuid) return;
    try {
      const rules = await ruleService.getRulesForEntity(entityData.uuid);
      setEntityRules(rules);
    } catch (err) {
      console.error('Failed to fetch entity rules:', err);
      setEntityRules([]);
    }
  }, [entityData?.uuid, ruleService]);

  useEffect(() => {
    fetchEntityRules();
  }, [fetchEntityRules]);

  const fetchEntityActions = useCallback(async () => {
    if (!entityData?.uuid) return;
    try {
      const actions = await actionsApi.getForEntity(entityData.uuid);
      setEntityActions(actions);
    } catch {
      setEntityActions([]);
    }
  }, [entityData?.uuid]);

  useEffect(() => {
    fetchEntityActions();
  }, [fetchEntityActions]);

  const fetchEntityStateMachines = useCallback(async () => {
    if (!entityData?.uuid) return;
    try {
      const machines = await stateMachinesApi.getForEntity(entityData.uuid);
      setEntityStateMachines(machines);
    } catch {
      setEntityStateMachines([]);
    }
  }, [entityData?.uuid]);

  useEffect(() => {
    fetchEntityStateMachines();
  }, [fetchEntityStateMachines]);

  const handleCreateEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!service || !newEntityName) {
      setError('Service and entity name are required');
      return;
    }
    try {
      setLoading(true);
      const currentDate = new Date().toISOString();
      const newEntity: Entity = {
        uuid: crypto.randomUUID(),
        name: newEntityName,
        description: newEntityDescription || `${newEntityName} entity`,
        attributes: [],
        metadata: [],
        createdAt: currentDate,
        updatedAt: currentDate,
      };
      try {
        await servicesApi.createEntity(service, newEntity);
        navigate(`/packages/${service}/entities/${newEntityName}`);
      } catch (err: any) {
        if (err.response) {
          setError(`API error: ${err.response.data?.message || err.message || 'Unknown error'}`);
        } else {
          setError(`Error: ${err.message || 'Unknown error'}`);
        }
        setLoading(false);
      }
    } catch {
      setError('Failed to create entity. Please try again.');
      setLoading(false);
    }
  };

  const handleCloneEntity = async () => {
    if (!entityData || !service) return;
    try {
      const clonedName = `${entityData.name}Copy`;
      const currentDate = new Date().toISOString();
      const cloned: Entity = {
        ...entityData,
        uuid: crypto.randomUUID(),
        name: clonedName,
        status: undefined,
        createdAt: currentDate,
        updatedAt: currentDate,
        attributes: entityData.attributes.map(attr => ({
          ...attr,
          uuid: crypto.randomUUID(),
        })),
      };
      await servicesApi.createEntity(service, cloned);
      navigate(`/packages/${service}/entities/${clonedName}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to clone entity');
    }
  };

  const refreshEntity = async () => {
    if (!service || !entity) return;
    try {
      const r = await servicesApi.getEntitySchema(service, entity);
      setEntityData(r.data);
    } catch { /* ignore */ }
  };

  // ──────────────── Early returns ────────────────

  if (!service && !isCreateMode) {
    return <ErrorBanner message="Service name is required" />;
  }
  if (loading) {
    return <EmptyState kind="loading" message="Loading entity…" />;
  }
  if (error && !isCreateMode) {
    return <ErrorBanner message={error} />;
  }
  if (!entityData && !isCreateMode) {
    return <WarnBanner message="Entity not found" />;
  }

  if (isCreateMode) {
    return (
      <div
        style={{
          padding: 16,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          maxWidth: 640,
        }}
      >
        <h1
          className="mono"
          style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, marginBottom: 16 }}
        >
          Create new entity
        </h1>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={handleCreateEntity} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldLabel label="Entity name">
            <input
              type="text"
              className="w-full"
              style={fieldStyle}
              value={newEntityName}
              onChange={(e) => setNewEntityName(e.target.value)}
              placeholder="Enter entity name"
              required
            />
          </FieldLabel>
          <FieldLabel label="Description">
            <textarea
              className="w-full"
              style={{ ...fieldStyle, minHeight: 72, fontFamily: 'inherit', padding: '6px 8px' }}
              value={newEntityDescription}
              onChange={(e) => setNewEntityDescription(e.target.value)}
              placeholder="Enter entity description"
              rows={3}
            />
          </FieldLabel>
          <div>
            <button
              type="submit"
              style={{
                height: 34,
                padding: '0 14px',
                fontSize: 'var(--fs-md)',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              disabled={loading}
            >
              <Icon name="plus" size={14} />
              {loading ? 'Creating…' : 'Create entity'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ──────────────── Normal view ────────────────

  const attrCount = entityData?.attributes?.length || 0;
  const relCount = relationships.length;
  const ruleCount = entityRules.length;
  const actionsCount = entityActions.length;
  const smCount = entityStateMachines.length;

  const tabs: TabDef[] = [
    { id: 'attributes',     label: 'Attributes',      count: attrCount },
    { id: 'relationships',  label: 'Relationships',   count: relCount },
    { id: 'metadata',       label: 'Metadata' },
    { id: 'lineage',        label: 'Lineage' },
    { id: 'impact',         label: 'Impact' },
    { id: 'comments',       label: 'Comments' },
    { id: 'rules',          label: 'Rules',           count: ruleCount },
    { id: 'actions',        label: 'Actions',         count: actionsCount },
    { id: 'state-machines', label: 'State Machines',  count: smCount },
  ];

  const statusValue = entityData?.status || 'draft';
  const statusTone =
    statusValue === 'approved' ? 'success' :
    statusValue === 'submitted' ? 'warning' :
    statusValue === 'returned' ? 'danger' :
    'neutral';

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div style={{ padding: '5px 12px 4px' }}>
        <PageHeader
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: 'Home', path: '/' },
                { label: 'packages', path: '/packages' },
                { label: service ?? '', path: `/packages/${service}` },
                { label: entityData?.name ?? '', path: `/packages/${service}/entities/${entityData?.name}` },
              ]}
            />
          }
          meta={
            <>
              <Chip tone="meta" className="mono">{service}</Chip>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                {attrCount} attr · {relCount} rel
              </span>
              <Chip tone={statusTone as any} soft={statusTone !== 'neutral'}>{statusValue}</Chip>
            </>
          }
          description={entityData?.description}
          actions={
            <>
              {(statusValue === 'draft' || statusValue === 'returned') && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (!service || !entity) return;
                    try { await servicesApi.submitEntity(service, entity); await refreshEntity(); } catch { /* ignore */ }
                  }}
                >
                  Submit
                </Button>
              )}
              {statusValue === 'submitted' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!service || !entity) return;
                      try { await servicesApi.approveEntity(service, entity); await refreshEntity(); } catch { /* ignore */ }
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const comment = prompt('Return comment (optional):');
                      if (!service || !entity) return;
                      try { await servicesApi.returnEntity(service, entity, comment || undefined); await refreshEntity(); } catch { /* ignore */ }
                    }}
                  >
                    Return
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" icon="copy" onClick={handleCloneEntity}>Clone</Button>
              <Link to={`/visualization/${service}/${entity}`} style={{ display: 'inline-flex' }}>
                <Button size="sm" variant="ghost" icon="chart">Visualize</Button>
              </Link>
              <Link to={`/packages/${service}/entities/${entity}/edit`} style={{ display: 'inline-flex' }}>
                <Button size="sm" variant="primary" icon="edit">Edit</Button>
              </Link>
            </>
          }
        />
      </div>

      {/* ───── Tabs ───── */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 0,
          padding: '0 8px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderTop: 0,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {tabs.map((t) => {
          const isActive = activeTab === t.id;
          const isEmpty = typeof t.count === 'number' && t.count === 0;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActiveTab(t.id);
                if (t.id === 'impact' && !impact && entityData?.uuid) {
                  setImpactLoading(true);
                  servicesApi.getImpactAnalysis(entityData.uuid)
                    .then(setImpact)
                    .catch(() => {})
                    .finally(() => setImpactLoading(false));
                }
              }}
              style={{
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                color: isActive ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 'var(--fs-sm)',
                fontWeight: isActive ? 600 : 400,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: -1,
                cursor: 'pointer',
                opacity: !isActive && isEmpty ? 0.55 : 1,
              }}
            >
              {t.label}
              {typeof t.count === 'number' && (
                <span
                  className="mono"
                  style={{
                    fontSize: 'var(--fs-xs)',
                    color: t.count === 0 ? 'var(--text-subtle)' : 'var(--text-muted)',
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ───── Tab content ───── */}
      <div
        className="flex-1 overflow-auto min-h-0"
        style={{
          padding: 12,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderTop: 0,
          borderRadius: '0 0 var(--radius-md) var(--radius-md)',
        }}
      >
        {activeTab === 'attributes' && entityData && (
          <AttributeList
            attributes={entityData.attributes}
            entityName={entityData.name}
            entityUuid={entityData.uuid}
            serviceName={service || ''}
            onAttributeUpdated={() => fetchEntityData(false)}
          />
        )}

        {activeTab === 'relationships' && entityData && (
          <RelationshipList
            relationships={relationships}
            entityName={entityData.name}
            serviceName={service || ''}
            onRelationshipUpdated={() => fetchEntityData(false)}
          />
        )}

        {activeTab === 'metadata' && entityData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Stereotype:</label>
              <select
                style={{ ...fieldStyle, width: 240 }}
                value={entityData.stereotype || ''}
                onChange={(e) => {
                  const st = stereotypes.find((s) => s.id === e.target.value) || null;
                  setCurrentStereotype(st);
                  setEntityData({ ...entityData, stereotype: e.target.value || undefined });
                }}
              >
                <option value="">None</option>
                {stereotypes.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {currentStereotype && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                  {currentStereotype.description}
                </span>
              )}
            </div>
            <MetadataEditor
              entries={entityData.metadata || []}
              stereotype={currentStereotype}
              onChange={(entries) => setEntityData({ ...entityData, metadata: entries })}
            />
          </div>
        )}

        {activeTab === 'lineage' && entityData && service && (
          <LineageView entityUuid={entityData.uuid} service={service} />
        )}

        {activeTab === 'impact' && (
          <div>
            {impactLoading ? (
              <EmptyState kind="loading" message="Analyzing impact…" />
            ) : impact ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ImpactSection title={`Relationships (${impact.relationships.length})`}>
                  {impact.relationships.length === 0 ? (
                    <MutedText>No relationships reference this entity.</MutedText>
                  ) : (
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {impact.relationships.map((r) => (
                        <li key={r.uuid} style={{ fontSize: 'var(--fs-sm)', display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Chip tone="info">rel</Chip>
                          <span>{r.sourceEntity} → {r.targetEntity}</span>
                          {r.description && <span style={{ color: 'var(--text-subtle)' }}>({r.description})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </ImpactSection>
                <ImpactSection title={`Cases (${impact.cases.length})`}>
                  {impact.cases.length === 0 ? (
                    <MutedText>Not included in any case.</MutedText>
                  ) : (
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {impact.cases.map((c) => (
                        <li key={c.uuid} style={{ fontSize: 'var(--fs-sm)' }}>
                          <Link to={`/cases/${c.uuid}`} style={{ color: 'var(--accent)' }}>{c.name}</Link>
                          <span className="mono" style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)', marginLeft: 8 }}>{c.path}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </ImpactSection>
                <ImpactSection title={`Diagrams (${impact.diagrams.length})`}>
                  {impact.diagrams.length === 0 ? (
                    <MutedText>Not used in any diagram.</MutedText>
                  ) : (
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {impact.diagrams.map((d) => (
                        <li key={d.id} style={{ fontSize: 'var(--fs-sm)' }}>
                          <Link to={`/diagram?layout=${d.id}`} style={{ color: 'var(--accent)' }}>{d.name}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </ImpactSection>
              </div>
            ) : (
              <MutedText>Click the Impact tab to load dependency analysis.</MutedText>
            )}
          </div>
        )}

        {activeTab === 'comments' && service && entity && (
          <ReviewComments service={service} entityName={entity} />
        )}

        {activeTab === 'rules' && entityData && (
          <EntityRulesList
            entityName={entityData.name}
            attributes={entityData.attributes || []}
            rules={entityRules}
            onRulesChanged={() => {
              fetchEntityRules();
              fetchEntityData(false);
            }}
          />
        )}

        {activeTab === 'actions' && entityData && (
          <EntityActionsTab
            entity={entityData}
            actions={entityActions}
            onActionsChanged={fetchEntityActions}
          />
        )}

        {activeTab === 'state-machines' && entityData && (
          <EntityStateMachinesTab
            entity={entityData}
            machines={entityStateMachines}
            onMachinesChanged={fetchEntityStateMachines}
          />
        )}
      </div>
    </div>
  );
};

// ──────────────── Local helpers ────────────────

const fieldStyle = {
  height: 28,
  padding: '0 8px',
  fontSize: 'var(--fs-sm)',
  background: 'var(--bg-raised)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  fontFamily: 'inherit',
} as const;

const FieldLabel = ({ label, children }: { label: string; children: ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{label}</span>
    {children}
  </label>
);

const ErrorBanner = ({ message }: { message: string }) => (
  <div
    style={{
      padding: '10px 14px',
      background: 'var(--danger-soft)',
      color: 'var(--danger)',
      border: '1px solid var(--danger)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--fs-sm)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}
  >
    <Icon name="warning" size={14} /> {message}
  </div>
);

const WarnBanner = ({ message }: { message: string }) => (
  <div
    style={{
      padding: '10px 14px',
      background: 'var(--warning-soft)',
      color: 'var(--warning)',
      border: '1px solid var(--warning)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--fs-sm)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}
  >
    <Icon name="warning" size={14} /> {message}
  </div>
);

const MutedText = ({ children }: { children: ReactNode }) => (
  <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>{children}</p>
);

const ImpactSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <h4
      className="uppercase"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-subtle)',
        letterSpacing: '0.04em',
        fontWeight: 600,
        marginBottom: 6,
      }}
    >
      {title}
    </h4>
    {children}
  </div>
);

export default EntityDetail;
