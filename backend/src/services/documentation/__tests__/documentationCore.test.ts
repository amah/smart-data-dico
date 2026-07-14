import { parseDocumentation } from '../documentationParser.js';
import { chunkDocumentation } from '../documentationChunker.js';
import { findDuplicateDocumentationUuids } from '../documentationValidation.js';

const SOURCE = `---
uuid: 5df7f67a-376c-4dc2-ac81-46078943d423
title: Order lifecycle
scope: package
tags: [orders]
related:
  - ref: document:11111111-1111-4111-8111-111111111111
  - ref: chunk:doc:11111111-1111-4111-8111-111111111111#summary
  - ref: entity:order
customField: preserved
---
# Lifecycle
Intro.

<!-- chunk: cancellation-policy -->
## Cancellation
Can cancel before fulfilment.

\`\`\`md
# not a heading
\`\`\`

## Cancellation
Second section.
`;

describe('documentation core', () => {
  it('parses front matter, derives location fields and preserves extensions', () => {
    const result = parseDocumentation(SOURCE, { sourcePath: 'orders/documentation/lifecycle.md', scope: 'package', packageName: 'orders' });
    expect(result.issues.some(issue => issue.severity === 'error')).toBe(false); expect(result.document?.extensions).toEqual({ customField: 'preserved' });
    expect(result.document?.packageName).toBe('orders'); expect(result.document?.content).toContain('# Lifecycle');
  });
  it('reports malformed front matter and location mismatches', () => {
    expect(parseDocumentation('hello', { sourcePath: 'x.md', scope: 'project' }).document).toBeUndefined();
    const result = parseDocumentation(SOURCE, { sourcePath: 'documentation/x.md', scope: 'project' });
    expect(result.issues.some(issue => issue.field === 'scope')).toBe(true);
  });
  it('creates deterministic, linked chunks and respects explicit anchors and fences', () => {
    const document = parseDocumentation(SOURCE, { sourcePath: 'orders/documentation/lifecycle.md', scope: 'package', packageName: 'orders' }).document!;
    const chunks = chunkDocumentation(document);
    expect(chunks.map(chunk => chunk.anchor)).toEqual(['lifecycle', 'cancellation-policy', 'lifecycle-cancellation']);
    expect(chunks[1].id).toContain('#cancellation-policy'); expect(chunks[1].content).toContain('# not a heading');
    expect(chunks[1].nextChunkId).toBe(chunks[2].id); expect(chunks[2].previousChunkId).toBe(chunks[1].id);
    expect(chunks[1]).toMatchObject({
      tags: ['orders'],
      relatedDocumentUuids: ['11111111-1111-4111-8111-111111111111'],
      relatedChunkIds: ['doc:11111111-1111-4111-8111-111111111111#summary'],
    });
    expect(chunks[1].descriptors).toEqual(expect.arrayContaining(['cancellation', 'cancel']));
    expect(chunkDocumentation({ ...document, content: document.content.replace('Second section.', 'Changed.') })[1].id).toBe(chunks[1].id);
  });
  it('recursively bounds large heading sections and documents without headings', () => {
    const document = parseDocumentation(SOURCE, { sourcePath: 'orders/documentation/lifecycle.md', scope: 'package', packageName: 'orders' }).document!;
    const noHeadings = { ...document, title: 'Large policy', content: Array.from({ length: 20 }, (_, index) => `Paragraph ${index} ${'policy '.repeat(25)}`).join('\n\n') };
    const chunks = chunkDocumentation(noHeadings, { targetTokens: 40, hardLimitTokens: 50 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every(chunk => chunk.tokenEstimate <= 50)).toBe(true);
    expect(chunks.map(chunk => chunk.anchor)).toEqual(chunks.map((_, index) => index === 0 ? 'large-policy' : `large-policy-part-${index + 1}`));
  });
  it('keeps ordinary fenced blocks atomic and applies stable suffixes only to oversized sections', () => {
    const document = parseDocumentation(SOURCE, { sourcePath: 'orders/documentation/lifecycle.md', scope: 'package', packageName: 'orders' }).document!;
    const content = `<!-- chunk: stable -->\n# Stable\n\nIntro.\n\n\`\`\`sql\nselect *\nfrom orders;\n\`\`\`\n\n${Array.from({ length: 8 }, (_, index) => `Rule ${index}: ${'bounded '.repeat(20)}`).join('\n\n')}`;
    const chunks = chunkDocumentation({ ...document, content }, { targetTokens: 60, hardLimitTokens: 80 });
    expect(chunks[0].anchor).toBe('stable');
    expect(chunks.slice(1).every((chunk, index) => chunk.anchor === `stable-part-${index + 2}`)).toBe(true);
    expect(chunks.some(chunk => chunk.content.includes('```sql\nselect *\nfrom orders;\n```'))).toBe(true);
  });
  it('detects duplicate document UUIDs', () => {
    const document = parseDocumentation(SOURCE, { sourcePath: 'x.md', scope: 'package', packageName: 'orders' }).document!;
    expect(findDuplicateDocumentationUuids([document, { ...document, sourcePath: 'y.md' }])).toHaveLength(1);
  });
});
