import { Request, Response } from 'express';
import * as YAML from 'yaml';
import { MetadataEntry } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import { wsId, pathOf } from '../storage/contract/types.js';

interface ModelMetadataDoc {
  stereotype?: string;
  metadata: MetadataEntry[];
}

const DICT_WS = wsId('dictionaries');
const METADATA_DIR = pathOf('.dico');
const METADATA_FILE = pathOf('.dico/metadata.yaml');

async function readModelMetadata(): Promise<ModelMetadataDoc> {
  try {
    const raw = await storageRegistry.getBackend().read(DICT_WS, METADATA_FILE);
    const parsed = YAML.parse(raw) || {};
    return {
      stereotype: parsed.stereotype,
      metadata: Array.isArray(parsed.metadata) ? parsed.metadata : [],
    };
  } catch (e) {
    if ((e as { code?: string }).code === 'not-found') return { metadata: [] };
    throw e;
  }
}

async function writeModelMetadata(doc: ModelMetadataDoc): Promise<void> {
  const backend = storageRegistry.getBackend();
  await backend.mkdir(DICT_WS, METADATA_DIR, true);
  const body: ModelMetadataDoc = {
    ...(doc.stereotype ? { stereotype: doc.stereotype } : {}),
    metadata: doc.metadata || [],
  };
  await backend.write(DICT_WS, METADATA_FILE, YAML.stringify(body));
}

export const getModelMetadata = async (_req: Request, res: Response) => {
  try {
    res.json({ message: 'Success', data: await readModelMetadata() });
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
    await writeModelMetadata(doc);
    res.json({ message: 'Model metadata saved', data: doc });
  } catch (error) {
    logger.error('Error saving model metadata', error);
    res.status(500).json({ message: 'Error saving model metadata', error });
  }
};
