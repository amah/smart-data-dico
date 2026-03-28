import type { ElementDefinition } from 'cytoscape';
import type { Package } from '../../types';

export interface CompoundNodeResult {
  compoundNodes: ElementDefinition[];
  parentMapping: Record<string, string>;
}

export function mapPackagesToCompoundNodes(packages: Package[]): CompoundNodeResult {
  const compoundNodes: ElementDefinition[] = [];
  const parentMapping: Record<string, string> = {};

  function walk(pkg: Package, parentNodeId?: string) {
    const nodeId = `pkg-${pkg.id || pkg.name}`;

    compoundNodes.push({
      group: 'nodes',
      data: {
        id: nodeId,
        label: pkg.name,
        type: 'package',
        ...(parentNodeId ? { parent: parentNodeId } : {}),
      },
    });

    // Assign entities to this package
    if (pkg.entities) {
      for (const entity of pkg.entities) {
        parentMapping[entity.uuid] = nodeId;
      }
    }

    // Recurse into sub-packages
    if (pkg.subPackages) {
      for (const sub of pkg.subPackages) {
        walk(sub, nodeId);
      }
    }
  }

  for (const pkg of packages) {
    walk(pkg);
  }

  return { compoundNodes, parentMapping };
}
