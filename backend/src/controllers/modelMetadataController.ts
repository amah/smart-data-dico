import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { config } from '../kernel/config.js';
import { MetadataEntry } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';

interface ModelMetadataDoc {
  stereotype?: string;
  metadata: MetadataEntry[];
}

const getModelMetadataFile = () => path.join(config.dataDir, '.dico', 'metadata.yaml');

function readModelMetadata(): ModelMetadataDoc {
  const file = getModelMetadataFile();
  if (!fs.existsSync(file)) return { metadata: [] };
  const parsed = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  return {
    stereotype: parsed.stereotype,
    metadata: Array.isArray(parsed.metadata) ? parsed.metadata : [],
  };
}

function writeModelMetadata(doc: ModelMetadataDoc): void {
  const file = getModelMetadataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: ModelMetadataDoc = {
    ...(doc.stereotype ? { stereotype: doc.stereotype } : {}),
    metadata: doc.metadata || [],
  };
  fs.writeFileSync(file, YAML.stringify(body), 'utf8');
}

export const getModelMetadata = async (_req: Request, res: Response) => {
  try {
    res.json({ message: 'Success', data: readModelMetadata() });
  } catch (error) {
    logger.error('Error reading model metadata', error);
    res.status(500).json({ message: 'Error reading model metadata', error });
  }
};

export const putModelMetadata = async (req: Request, res: Response) => {
  try {
    const { stereotype, metadata } = req.body || {};
    if (metadata !== undefined && !Array.isArray(metadata)) {
      return res.status(400).json({ message: 'metadata must be an array of MetadataEntry' });
    }
    const doc: ModelMetadataDoc = {
      stereotype: typeof stereotype === 'string' && stereotype ? stereotype : undefined,
      metadata: metadata || [],
    };
    writeModelMetadata(doc);
    res.json({ message: 'Model metadata saved', data: doc });
  } catch (error) {
    logger.error('Error saving model metadata', error);
    res.status(500).json({ message: 'Error saving model metadata', error });
  }
};
