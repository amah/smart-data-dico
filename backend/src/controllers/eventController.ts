/**
 * Event controller (#201 Phase 2).
 *
 * Handles HTTP requests for the /api/events and /api/entities/:uuid/events
 * endpoints. Auth: ADMIN/EDITOR for writes, VIEWER for reads.
 */

import { Request, Response } from 'express';
import { eventService } from '../services/eventService.js';
import { logger } from '../utils/logger.js';

export const listEvents = async (req: Request, res: Response) => {
  try {
    const packageName = typeof req.query.package === 'string' ? req.query.package : undefined;
    const events = await eventService.list({ packageName });
    res.json({ message: 'Success', data: events });
  } catch (error) {
    logger.error('Error listing events', error);
    res.status(500).json({ message: 'Error listing events', error });
  }
};

export const listEventsForEntity = async (req: Request, res: Response) => {
  try {
    const events = await eventService.list({ ownerRef: req.params.uuid });
    res.json({ message: 'Success', data: events });
  } catch (error) {
    logger.error('Error listing events for entity', error);
    res.status(500).json({ message: 'Error listing events for entity', error });
  }
};

export const getEvent = async (req: Request, res: Response) => {
  try {
    const event = await eventService.getByUuid(req.params.uuid);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    res.json({ message: 'Success', data: event });
  } catch (error) {
    logger.error('Error fetching event', error);
    res.status(500).json({ message: 'Error fetching event', error });
  }
};

export const createEvent = async (req: Request, res: Response) => {
  try {
    const result = await eventService.create(req.body);
    if ('errors' in result) {
      return res.status(400).json({ message: 'Failed to create event', errors: result.errors });
    }
    res.status(201).json({ message: 'Event created successfully', data: result });
  } catch (error) {
    logger.error('Error creating event', error);
    res.status(500).json({ message: 'Error creating event', error });
  }
};

export const updateEvent = async (req: Request, res: Response) => {
  try {
    const result = await eventService.update(req.params.uuid, req.body);
    if (result === null) {
      return res.status(404).json({ message: 'Event not found' });
    }
    if ('errors' in result) {
      return res.status(400).json({ message: 'Failed to update event', errors: result.errors });
    }
    res.json({ message: 'Event updated successfully', data: result });
  } catch (error) {
    logger.error('Error updating event', error);
    res.status(500).json({ message: 'Error updating event', error });
  }
};

export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const ok = await eventService.delete(req.params.uuid);
    if (!ok) return res.status(404).json({ message: 'Event not found' });
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    logger.error('Error deleting event', error);
    res.status(500).json({ message: 'Error deleting event', error });
  }
};
