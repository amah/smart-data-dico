import { Router } from 'express';
import {
  importJsonSchema,
  importSqlDdl,
  previewSqlDdl,
  diffSqlDdl,
  commitSqlDdl,
  previewOracleSchema,
  previewDbSchema,
  exportJsonSchema,
  exportMarkdown,
  getQualityReport,
} from '../../controllers/importExportController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Import/Export
router.post('/api/import/json-schema', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), importJsonSchema);
router.post('/api/import/sql-ddl', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), importSqlDdl);
// Preview SQL DDL → parsed entities (no disk writes) — #69 C1
router.post('/api/import/sql-ddl/preview', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), previewSqlDdl);
// Diff parsed entities against an existing service — #69 C2
router.post('/api/import/sql-ddl/diff', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), diffSqlDdl);
// Merge + commit parsed entities into a service — #69 C2
router.post('/api/import/sql-ddl/commit', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), commitSqlDdl);
// Live Oracle DB introspection (Thin mode) → parsed entities (no disk writes) — #69 C3
router.post('/api/import/oracle/preview', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), previewOracleSchema);
// Unified live DB introspection — dispatches on body.dialect (oracle|postgres|mysql|mssql) — #79/#80/#81
router.post('/api/import/db/preview', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), previewDbSchema);
router.get('/api/export/json-schema/:service', exportJsonSchema);
router.get('/api/export/markdown/:service', exportMarkdown);
// Quality
router.get('/api/quality/report', getQualityReport);
export default router;
