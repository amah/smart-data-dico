/**
 * Rule service (#74) — CRUD across the three storage scopes.
 *
 * Storage scopes:
 *   - entity   → inlined on the entity (`entity.rules`)
 *   - package  → packages/{pkg}/rules section
 *   - case     → embedded in {Name}.case.yaml under `rules`
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
  readCaseRules,
  writeCaseRules,
  readGlobalRules,
  writeGlobalRules,
  listAllEntityRuleFiles,
  listPackagesWithRules,
  listCases,
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

interface ListFilters {
  scope?: RuleScope;
  severity?: 'info' | 'warning' | 'error';
  enforcement?: 'save' | 'process' | 'advisory';
  /** Match rules whose targets include this node UUID (entity, attribute, etc.) */
  targetUuid?: string;
  /** For case scope: filter by case uuid */
  caseUuid?: string;
  /** For package scope: filter by package name */
  packageName?: string;
}

class RuleService {
  /** List all rules from all storage scopes, optionally filtered. */
  async listRules(filters: ListFilters = {}): Promise<Rule[]> {
    const all: Rule[] = [];

    // Entity-sidecar rules.
    // (#85 R2) Synthetic rules derived from attribute validation are no
    // longer produced — validation lives on the attribute itself and is
    // surfaced through the Integrity page (#85 R5).
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

    // Global (cross-package) rules (#75)
    if (!filters.scope || filters.scope === 'global') {
      const globalRules = await readGlobalRules();
      all.push(...globalRules);
    }

    // Case-scoped rules
    if (!filters.scope || filters.scope === 'case') {
      if (filters.caseUuid) {
        const rules = await readCaseRules(filters.caseUuid);
        all.push(...rules);
      } else {
        const cases = await listCases();
        for (const c of cases) {
          const rules = ((c.rules as Rule[]) || []);
          all.push(...rules);
        }
      }
    }

    // Backfill enforcement = 'advisory' on rules created before #76 introduced
    // the field. Non-destructive — only patches the in-memory copy.
    for (const rule of all) {
      if (!rule.enforcement) rule.enforcement = 'advisory';
    }

    // Apply filters
    return all.filter(rule => {
      if (filters.severity && rule.severity !== filters.severity) return false;
      if (filters.enforcement && rule.enforcement !== filters.enforcement) return false;
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
    // Default enforcement = 'advisory' if caller didn't specify
    if (!input.enforcement) input.enforcement = 'advisory';
    const errors = validateRule(input);
    if (errors.length > 0) {
      return { success: false, errors };
    }
    let rule: Rule = {
      uuid: generateUUID(),
      name: input.name!,
      description: input.description!,
      severity: input.severity!,
      enforcement: input.enforcement!,
      scope: input.scope!,
      targets: input.targets!,
      packageName: input.packageName,
      entityUuid: input.entityUuid,
      caseUuid: input.caseUuid,
      expression: input.expression,
      tags: input.tags,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Auto-promote/demote based on target packages (#75)
    rule = await this.applyAutoScope(rule);
    const saved = await this.saveRuleToScope(rule);
    if (!saved) return { success: false, errors: ['Failed to write rule to storage'] };
    return { success: true, rule };
  }

  /** Update an existing rule by uuid. Re-routes to new scope if scope changed. */
  async updateRule(uuid: string, input: Partial<Rule>): Promise<{ success: boolean; rule?: Rule; errors?: string[] }> {
    const existing = await this.getRule(uuid);
    if (!existing) return { success: false, errors: [`Rule ${uuid} not found`] };

    let merged: Rule = {
      ...existing,
      ...input,
      uuid: existing.uuid,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const errors = validateRule(merged);
    if (errors.length > 0) return { success: false, errors };

    // Auto-promote/demote based on target packages (#75)
    merged = await this.applyAutoScope(merged, existing.scope, existing.packageName);

    // If scope or scope-anchor changed, remove from old location first
    const scopeMoved =
      existing.scope !== merged.scope ||
      existing.packageName !== merged.packageName ||
      existing.entityUuid !== merged.entityUuid ||
      existing.caseUuid !== merged.caseUuid;
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
      case 'case': {
        if (!rule.caseUuid) return false;
        const existing = await readCaseRules(rule.caseUuid);
        const updated = [...existing.filter(r => r.uuid !== rule.uuid), rule];
        return writeCaseRules(rule.caseUuid, updated);
      }
      case 'global': {
        const existing = await readGlobalRules();
        const updated = [...existing.filter(r => r.uuid !== rule.uuid), rule];
        return writeGlobalRules(updated);
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
      case 'case': {
        if (!rule.caseUuid) return false;
        const existing = await readCaseRules(rule.caseUuid);
        const updated = existing.filter(r => r.uuid !== rule.uuid);
        return writeCaseRules(rule.caseUuid, updated);
      }
      case 'global': {
        const existing = await readGlobalRules();
        const updated = existing.filter(r => r.uuid !== rule.uuid);
        return writeGlobalRules(updated);
      }
      default:
        return false;
    }
  }

  // ─── Auto-promote / auto-demote (#75) ────────────────────────────────

  /**
   * Determine the correct scope for a rule based on its targets.
   * Called before save. If targets span 2+ packages → global.
   * If all targets are in one package → that package's scope (keep
   * the caller's intent for entity vs package).
   */
  private resolveScope(rule: Rule): { scope: RuleScope; packageName?: string } {
    const packages = new Set<string>();
    for (const t of rule.targets) {
      if (t.packageName) packages.add(t.packageName);
    }
    if (packages.size >= 2) {
      return { scope: 'global' };
    }
    // If all targets share one package, use the caller's original scope
    // (entity or package) rather than force-upgrading.
    if (packages.size === 1) {
      const pkg = [...packages][0];
      if (rule.scope === 'global') {
        // Auto-demote: was global, now all targets in one package → package scope
        return { scope: 'package', packageName: pkg };
      }
    }
    return { scope: rule.scope, packageName: rule.packageName };
  }

  /**
   * Wrap around createRule/updateRule to apply auto-promote/demote.
   * Checks if the resolved scope differs from what the caller requested
   * and adjusts accordingly — including moving the rule between files.
   */
  private async applyAutoScope(rule: Rule, oldScope?: RuleScope, oldPkg?: string): Promise<Rule> {
    const resolved = this.resolveScope(rule);
    if (resolved.scope !== rule.scope) {
      logger.info(`Auto-${resolved.scope === 'global' ? 'promote' : 'demote'} rule ${rule.uuid}: ${rule.scope} → ${resolved.scope}`);
    }
    rule.scope = resolved.scope;
    if (resolved.packageName !== undefined) {
      rule.packageName = resolved.packageName;
    }
    return rule;
  }
}

export const ruleService = new RuleService();
