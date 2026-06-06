/**
 * Read-only derivation of JPA annotations from the model plus jpa.* and
 * physical.* metadata, for a preview panel. Best-effort sketch (entity + fields)
 * — NOT a full code generator — so users can see how their mappings resolve.
 */
import type { Entity, MetadataEntry, MetadataValue } from '../types';

const meta = (md: MetadataEntry[] | undefined, key: string): MetadataValue | undefined =>
  (md || []).find(m => m.name === key)?.value;
const flag = (md: MetadataEntry[] | undefined, key: string): boolean =>
  meta(md, key) === true || meta(md, key) === 'true';
const str = (v: MetadataValue | undefined): string => (v === undefined || v === null ? '' : String(v));

// Convention AttributeType → Java type (overridable via jpa.javaType).
const JAVA_TYPE: Record<string, string> = {
  string: 'String', integer: 'Long', number: 'BigDecimal', boolean: 'Boolean',
  datetime: 'Instant', date: 'LocalDate', time: 'LocalTime', 'date-time': 'Instant',
  timestamp: 'Instant', duration: 'Duration', uuid: 'UUID', enum: 'String', object: 'Object', array: 'List<?>',
};

/** Produce the derived JPA source lines for one entity. */
export function deriveEntityJpa(entity: Entity, nameByRef: Map<string, string>): string[] {
  const em = entity.metadata;
  const lines: string[] = [];

  const pkg = str(meta(em, 'jpa.package'));
  if (pkg) lines.push(`package ${pkg};`, '');

  const embeddable = flag(em, 'jpa.embeddable');
  const mappedSuper = flag(em, 'jpa.mappedSuperclass');
  const strategy = str(meta(em, 'jpa.inheritanceStrategy'));
  const discCol = str(meta(em, 'jpa.discriminatorColumn'));
  const discVal = str(meta(em, 'jpa.discriminatorValue'));

  if (strategy) lines.push(`@Inheritance(strategy = InheritanceType.${strategy})`);
  if (discCol) lines.push(`@DiscriminatorColumn(name = "${discCol}")`);
  lines.push(embeddable ? '@Embeddable' : mappedSuper ? '@MappedSuperclass' : '@Entity');
  const table = str(meta(em, 'physical.tableName'));
  if (!embeddable && !mappedSuper && table) lines.push(`@Table(name = "${table}")`);
  if (discVal) lines.push(`@DiscriminatorValue("${discVal}")`);

  const cls = str(meta(em, 'jpa.className')) || entity.name;
  const extRef = str(meta(em, 'jpa.extends'));
  const parent = extRef ? (nameByRef.get(extRef) || extRef) : '';
  lines.push(`public class ${cls}${parent ? ` extends ${parent}` : ''} {`);

  for (const a of entity.attributes || []) {
    const am = a.metadata;
    if (flag(am, 'jpa.transient')) { lines.push('  @Transient'); }
    const isPk = a.primaryKey === true || flag(am, 'isPrimaryKey');
    if (isPk) {
      lines.push('  @Id');
      const gv = str(meta(am, 'jpa.generatedValue'));
      if (gv && gv !== 'NONE') lines.push(`  @GeneratedValue(strategy = GenerationType.${gv})`);
    }
    if (flag(am, 'jpa.version')) lines.push('  @Version');
    if (flag(am, 'jpa.lob')) lines.push('  @Lob');
    if (String(a.type) === 'enum') lines.push(`  @Enumerated(EnumType.${str(meta(am, 'jpa.enumerated')) || 'STRING'})`);
    const col = str(meta(am, 'physical.columnName'));
    if (col) lines.push(`  @Column(name = "${col}"${a.required ? ', nullable = false' : ''})`);
    const javaType = str(meta(am, 'jpa.javaType')) || JAVA_TYPE[String(a.type)] || 'String';
    lines.push(`  private ${javaType} ${a.name};`);
  }
  lines.push('  // + relationship fields (@OneToMany / @ManyToOne) …');
  lines.push('}');
  return lines;
}
