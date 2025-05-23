import { Request, Response } from 'express';
import { diagramService, DiagramLayout } from '../services/diagramService';
import { logger } from '../utils/logger';

export class DiagramController {
  async saveDiagramLayout(req: Request, res: Response): Promise<void> {
    try {
      const layoutData = req.body as Omit<DiagramLayout, 'createdAt' | 'updatedAt'>;
      
      if (!layoutData.id || !layoutData.name) {
        res.status(400).json({
          message: 'Missing required fields: id and name are required'
        });
        return;
      }

      const savedLayout = await diagramService.saveDiagramLayout(layoutData);
      
      res.status(201).json({
        message: 'Diagram layout saved successfully',
        data: savedLayout
      });
    } catch (error) {
      logger.error('Error in saveDiagramLayout:', error);
      res.status(500).json({
        message: 'Failed to save diagram layout',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async loadDiagramLayout(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).json({
          message: 'Diagram layout ID is required'
        });
        return;
      }

      const layout = await diagramService.loadDiagramLayout(id);
      
      if (!layout) {
        res.status(404).json({
          message: 'Diagram layout not found'
        });
        return;
      }

      res.json({
        message: 'Diagram layout loaded successfully',
        data: layout
      });
    } catch (error) {
      logger.error('Error in loadDiagramLayout:', error);
      res.status(500).json({
        message: 'Failed to load diagram layout',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async updateDiagramLayout(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      if (!id) {
        res.status(400).json({
          message: 'Diagram layout ID is required'
        });
        return;
      }

      const updatedLayout = await diagramService.updateDiagramLayout(id, updates);
      
      res.json({
        message: 'Diagram layout updated successfully',
        data: updatedLayout
      });
    } catch (error) {
      logger.error('Error in updateDiagramLayout:', error);
      if (error instanceof Error && error.message === 'Diagram layout not found') {
        res.status(404).json({
          message: 'Diagram layout not found'
        });
      } else {
        res.status(500).json({
          message: 'Failed to update diagram layout',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  async deleteDiagramLayout(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).json({
          message: 'Diagram layout ID is required'
        });
        return;
      }

      await diagramService.deleteDiagramLayout(id);
      
      res.json({
        message: 'Diagram layout deleted successfully'
      });
    } catch (error) {
      logger.error('Error in deleteDiagramLayout:', error);
      res.status(500).json({
        message: 'Failed to delete diagram layout',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async listDiagramLayouts(req: Request, res: Response): Promise<void> {
    try {
      const { service } = req.query;
      
      const layouts = await diagramService.listDiagramLayouts(service as string);
      
      res.json({
        message: 'Diagram layouts retrieved successfully',
        data: layouts
      });
    } catch (error) {
      logger.error('Error in listDiagramLayouts:', error);
      res.status(500).json({
        message: 'Failed to list diagram layouts',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const diagramController = new DiagramController();