/**
 * Rule service (#74) — CRUD across the three storage scopes.
 *
 * Storage scopes:
 *   - entity     → {entityUuid}.rules.yaml sidecar
 *   - package    → microservices/{pkg}/rules.yaml
 *   - perspective → embedded in perspectives/{uuid}.yaml under `rules`
 *
 * Rule UUIDs are unique across the whole dictionary, so callers can lookup
 * a rule by uuid without knowing its scope upfront.
 */
import { Rule, RuleScope, validateRule } from '../models/Rule.js';
import {
  readEntityRules,
  writeEntityRules,
  readPackageRules,
  writePackageRules,
  readPerspectiveRules,
  writePerspectiveRules,
  listAllEntityRuleFiles,
  listPackagesWithRules,
  listPerspectives,
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

interface ListFilters {
  scope?: RuleScope;
  severity?: 'info' | 'warning' | 'error';
  /** Match rules whose targets include this node UUID (entity, attribute, etc.) */
  targetUuid?: string;
  /** For perspective scope: filter by perspective uuid */
  perspectiveUuid?: string;
  /** For package scope: filter by package name */
  packageName?: string;
}

class RuleService {
  /** List all rules from all storage scopes, optionally filtered. */
  async listRules(filters: ListFilters = {}): Promise<Rule[]> {
    const all: Rule[] = [];

    // Entity-sidecar rules
    if (!filters.scope || filters.scope === 'entity') {
      const files = await listAllEntityRuleFiles();
      for (const { service, entityUuid } of files) {
        const rules = await readEntityRules(service, entityUuid);
        all.push(...rules);
      }
    }

    // Package-scoped rules
    if (!filters.scope || filters.scope === 'package') {
      const packages = filters.packageName
        ? [filters.packageName]
        : await listPackagesWithRules();
      for (const pkg of packages) {
        const rules = await readPackageRules(pkg);
        all.push(...rules);
      }
    }

    // Perspective-scoped rules
    if (!filters.scope || filters.scope === 'perspective') {
      if (filters.perspectiveUuid) {
        const rules = await readPerspectiveRules(filters.perspectiveUuid);
        all.push(...rules);
      } else {
        const perspectives = await listPerspectives();
        for (const p of perspectives) {
          const rules = ((p.rules as Rule[]) || []);
          all.push(...rules);
        }
      }
    }

    // Apply filters
    return all.filter(rule => {
      if (filters.severity && rule.severity !== filters.severity) return false;
      if (filters.targetUuid) {
        const hit = rule.targets.some(t =>
          t.uuid === filters.targetUuid || t.entityUuid === filters.targetUuid
        );
        if (!hit) return false;
      }
      return true;
    });
  }

  /** Get a single rule by uuid (scans all scopes). */
  async getRule(uuid: string): Promise<Rule | null> {
    const all = await this.listRules();
    return all.find(r => r.uuid === uuid) || null;
  }

  /** List rules whose targets include this entity (or any of its attributes). */
  async listRulesForEntity(entityUuid: string): Promise<Rule[]> {
    const all = await this.listRules();
    return all.filter(rule =>
      rule.targets.some(t =>
        t.uuid === entityUuid ||
        t.entityUuid === entityUuid
      )
    );
  }

  /** Create a rule. Storage location is determined by `scope`. */
  async createRule(input: Partial<Rule>): Promise<{ success: boolean; rule?: Rule; errors?: string[] }> {
    const errors = validateRule(input);
    if (errors.length > 0) {
      return { success: false, errors };
    }
    const rule: Rule = {
      uuid: generateUUID(),
      name: input.name!,
      description: input.description!,
      severity: input.severity!,
      scope: input.scope!,
      targets: input.targets!,
      packageName: input.packageName,
      entityUuid: input.entityUuid,
      perspectiveUuid: input.perspectiveUuid,
      expression: input.expression,
      tags: input.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.saveRuleToScope(rule);
    if (!saved) return { success: false, errors: ['Failed to write rule to storage'] };
    return { success: true, rule };
  }

  /** Update an existing rule by uuid. Re-routes to new scope if scope changed. */
  async updateRule(uuid: string, input: Partial<Rule>): Promise<{ success: boolean; rule?: Rule; errors?: string[] }> {
    const existing = await this.getRule(uuid);
    if (!existing) return { success: false, errors: [`Rule ${uuid} not found`] };

    const merged: Rule = {
      ...existing,
      ...input,
      uuid: existing.uuid,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const errors = validateRule(merged);
    if (errors.length > 0) return { success: false, errors };

    // If scope or scope-anchor changed, remove from old location first
    const scopeMoved =
      existing.scope !== merged.scope ||
      existing.packageName !== merged.packageName ||
      existing.entityUuid !== merged.entityUuid ||
      existing.perspectiveUuid !== merged.perspectiveUuid;
    if (scopeMoved) {
      await this.removeRuleFromScope(existing);
    }
    const saved = await this.saveRuleToScope(merged);
    if (!saved) return { success: false, errors: ['Failed to write updated rule to storage'] };
    return { success: true, rule: merged };
  }

  /** Delete a rule by uuid. */
  async deleteRule(uuid: string): Promise<{ success: boolean; errors?: string[] }> {
    const existing = await this.getRule(uuid);
    if (!existing) return { success: false, errors: [`Rule ${uuid} not found`] };
    const removed = await this.removeRuleFromScope(existing);
    if (!removed) return { success: false, errors: ['Failed to remove rule from storage'] };
    return { success: true };
  }

  // ─── Private helpers: route to the right storage location ────────────────

  private async saveRuleToScope(rule: Rule): Promise<boolean> {
    switch (rule.scope) {
      case 'entity': {
        if (!rule.entityUuid) return false;
        // We need a service name to find the sidecar — derive it from the first target's package context.
        // Walk all entity rule files to find which service owns this entity uuid.
        const files = await listAllEntityRuleFiles();
        let service = files.find(f => f.entityUuid === rule.entityUuid)?.service;
        if (!service) {
          // No existing sidecar — caller must provide via packageName, or we look up the entity
          service = rule.packageName;
        }
        if (!service) {
          logger.error(`Cannot determine service for entity ${rule.entityUuid}`);
          return false;
        }
        const existing = await readEntityRules(service, rule.entityUuid);
        const updated = [...existing.filter(r => r.uuid !== rule.uuid), rule];
        return writeEntityRules(service, rule.entityUuid, updated);
      }
      case 'package': {
        if (!rule.packageName) return false;
        const existing = await readPackageRules(rule.packageName);
        const updated = [...existing.filter(r => r.uuid !== rule.uuid), rule];
        return writePackageRules(rule.packageName, updated);
      }
      case 'perspective': {
        if (!rule.perspectiveUuid) return false;
        const existing = await readPerspectiveRules(rule.perspectiveUuid);
        const updated = [...existing.filter(r => r.uuid !== rule.uuid), rule];
        return writePerspectiveRules(rule.perspectiveUuid, updated);
      }
      default:
        return false;
    }
  }

  private async removeRuleFromScope(rule: Rule): Promise<boolean> {
    switch (rule.scope) {
      case 'entity': {
        if (!rule.entityUuid) return false;
        const files = await listAllEntityRuleFiles();
        const service = files.find(f => f.entityUuid === rule.entityUuid)?.service ?? rule.packageName;
        if (!service) return false;
        const existing = await readEntityRules(service, rule.entityUuid);
        const updated = existing.filter(r => r.uuid !== rule.uuid);
        return writeEntityRules(service, rule.entityUuid, updated);
      }
      case 'package': {
        if (!rule.packageName) return false;
        const existing = await readPackageRules(rule.packageName);
        const updated = existing.filter(r => r.uuid !== rule.uuid);
        return writePackageRules(rule.packageName, updated);
      }
      case 'perspective': {
        if (!rule.perspectiveUuid) return false;
        const existing = await readPerspectiveRules(rule.perspectiveUuid);
        const updated = existing.filter(r => r.uuid !== rule.uuid);
        return writePerspectiveRules(rule.perspectiveUuid, updated);
      }
      default:
        return false;
    }
  }
}

export const ruleService = new RuleService();
