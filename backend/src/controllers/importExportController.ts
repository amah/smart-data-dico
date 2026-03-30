import { Request, Response } from 'express';
import { importService } from '../services/importService.js';
import { exportService } from '../services/exportService.js';
import { qualityService } from '../services/qualityService.js';
import { logger } from '../utils/logger.js';

export const importJsonSchema = async (req: Request, res: Response) => {
  try {
    const { schema, service } = req.body;
    if (!schema || !service) return res.status(400).json({ message: 'schema and service are required' });
    const result = await importService.importFromJsonSchema(schema, service);
    res.json({ message: `Imported ${result.entities.length} entities`, data: result });
  } catch (error) {
    logger.error('Error importing JSON Schema', error);
    res.status(500).json({ message: 'Error importing JSON Schema', error });
  }
};

export const importSqlDdl = async (req: Request, res: Response) => {
  try {
    const { sql, service } = req.body;
    if (!sql || !service) return res.status(400).json({ message: 'sql and service are required' });
    const result = await importService.importFromSqlDdl(sql, service);
    res.json({ message: `Imported ${result.entities.length} entities`, data: result });
  } catch (error) {
    logger.error('Error importing SQL DDL', error);
    res.status(500).json({ message: 'Error importing SQL DDL', error });
  }
};

export const exportJsonSchema = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const schema = await exportService.exportToJsonSchema(service);
    res.json(schema);
  } catch (error) {
    logger.error('Error exporting JSON Schema', error);
    res.status(500).json({ message: 'Error exporting JSON Schema', error });
  }
};

export const exportMarkdown = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const markdown = await exportService.exportToMarkdown(service);
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${service}-data-dictionary.md"`);
    res.send(markdown);
  } catch (error) {
    logger.error('Error exporting Markdown', error);
    res.status(500).json({ message: 'Error exporting Markdown', error });
  }
};

export const getQualityReport = async (req: Request, res: Response) => {
  try {
    const service = req.query.service as string | undefined;
    const report = await qualityService.getQualityReport(service);
    res.json({ message: 'Success', data: report });
  } catch (error) {
    logger.error('Error getting quality report', error);
    res.status(500).json({ message: 'Error getting quality report', error });
  }
};
