import { InMemoryStorageBackend } from '../../../storage/memory/InMemoryStorageBackend.js';
import { pathOf, wsId } from '../../../storage/contract/types.js';
import { DocumentationRepository } from '../documentationRepository.js';
import { DocumentationService } from '../../documentationService.js';

const PROJECT_UUID = '11111111-1111-4111-8111-111111111111';
const PACKAGE_UUID = '22222222-2222-4222-8222-222222222222';

function markdown(uuid: string, title: string, extra = ''): string {
  return `---\nuuid: ${uuid}\ntitle: ${title}\n${extra}---\n\n# ${title}\n\nBody.\n`;
}

describe('DocumentationRepository and DocumentationService', () => {
  let backend: InMemoryStorageBackend;
  let repository: DocumentationRepository;
  let service: DocumentationService;

  beforeEach(() => {
    backend = new InMemoryStorageBackend();
    repository = new DocumentationRepository(backend);
    service = new DocumentationService(repository);
    const files = new Map<string, string>();
    files.set('documentation/project.md', markdown(PROJECT_UUID, 'Project guide', 'scope: project\ntags: [policy]\nrelated:\n  - ref: entity:customer\n'));
    files.set('sales/package.yaml', 'name: sales\n');
    files.set('sales/documentation/nested/package.md', markdown(PACKAGE_UUID, 'Sales guide', 'scope: package\npackageName: sales\nstatus: approved\n'));
    files.set('not-a-package/documentation/ignored.md', markdown('33333333-3333-4333-8333-333333333333', 'Ignored', 'scope: package\n'));
    backend.files.set('dictionaries', files);
  });

  it('discovers project and marker-backed package documentation recursively', async () => {
    const documents = await repository.list();
    expect(documents.map(document => document.uuid)).toEqual([PROJECT_UUID, PACKAGE_UUID]);
    expect(documents.find(document => document.uuid === PACKAGE_UUID)).toMatchObject({ packageName: 'sales', scope: 'package' });
  });

  it('treats adapter ENOENT as an optional missing documentation directory', async () => {
    backend.files.get('dictionaries')!.set('inventory/package.yaml', 'name: inventory\n');
    const originalList = backend.list.bind(backend);
    jest.spyOn(backend, 'list').mockImplementation(async (ws, path) => {
      if (String(path) === 'inventory/documentation') {
        throw Object.assign(new Error('missing directory'), { code: 'ENOENT' });
      }
      return originalList(ws, path);
    });

    await expect(repository.list()).resolves.toHaveLength(2);
  });

  it('filters and resolves direct element references', async () => {
    await expect(service.listDocuments({ scope: 'package', status: 'approved' }))
      .resolves.toEqual([expect.objectContaining({ uuid: PACKAGE_UUID })]);
    await expect(service.getForElement('entity', 'customer'))
      .resolves.toEqual([expect.objectContaining({ uuid: PROJECT_UUID })]);
  });

  it('paginates bounded chunk descriptors and reports review coverage', async () => {
    backend.files.get('dictionaries')!.set('documentation/project.md', markdown(
      PROJECT_UUID,
      'Project guide',
      'scope: project\ntags: [policy]\n',
    ).replace('# Project guide\n\nBody.', '# Project guide\n\nIntro.\n\n## First\n\nFirst body.\n\n## Second\n\nSecond body.'));
    const firstPage = await service.getChunkPage(PROJECT_UUID, { limit: 2 });
    expect(firstPage).toMatchObject({ total: 3, cursor: '0', nextCursor: '2', returnedTokenEstimate: 0 });
    expect(firstPage!.chunks.every(chunk => chunk.content === undefined)).toBe(true);
    const secondPage = await service.getChunkPage(PROJECT_UUID, { cursor: firstPage!.nextCursor, limit: 2, includeContent: true, tokenBudget: 1 });
    expect(secondPage!.chunks.every(chunk => chunk.contentOmitted)).toBe(true);

    const reviewedId = firstPage!.chunks[0].id;
    await expect(service.getReviewCoverage(PROJECT_UUID, [reviewedId, 'unknown']))
      .resolves.toMatchObject({ totalChunks: 3, reviewedChunks: 1, complete: false, unknownChunkIds: ['unknown'] });
    const allIds = (await service.getChunks(PROJECT_UUID))!.map(chunk => chunk.id);
    await expect(service.getReviewCoverage(PROJECT_UUID, allIds))
      .resolves.toMatchObject({ totalChunks: 3, reviewedChunks: 3, complete: true, missingChunkIds: [] });
  });

  it('omits oversized full content from agent retrieval while retaining an outline', async () => {
    backend.files.get('dictionaries')!.set('documentation/project.md', markdown(
      PROJECT_UUID,
      'Project guide',
      'scope: project\n',
    ).replace('Body.', 'large '.repeat(100)));
    await expect(service.getDocumentForAgent(PROJECT_UUID, true, 10)).resolves.toEqual(expect.objectContaining({
      contentOmitted: true,
      chunkCount: 1,
      outline: [expect.objectContaining({ sourcePath: 'documentation/project.md', tokenEstimate: expect.any(Number) })],
    }));
  });

  it('creates, updates and deletes authored markdown through storage', async () => {
    const created = await service.createDocument({
      title: 'New guide', scope: 'project', content: '# New guide\n', tags: ['new'],
    });
    expect(await backend.read(wsId('dictionaries'), pathOf(`documentation/${created.uuid}.md`))).toContain('title: New guide');

    const updated = await service.updateDocument(created.uuid, { title: 'Updated guide' });
    expect(updated?.title).toBe('Updated guide');
    expect(await service.deleteDocument(created.uuid)).toBe(true);
    await expect(service.getDocument(created.uuid)).resolves.toBeNull();
  });

  it('rejects traversal filenames and UUID mutation', async () => {
    await expect(service.createDocument({ title: 'Bad', scope: 'project', content: 'body', filename: '../bad.md' }))
      .rejects.toThrow('Invalid documentation filename');
    await expect(service.updateDocument(PROJECT_UUID, { uuid: PACKAGE_UUID }))
      .rejects.toThrow('uuid cannot be changed');
  });
});
