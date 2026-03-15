/**
 * Notification Plugin
 *
 * Lightweight notification service for success/error feedback.
 * Uses microkernel hooks for cross-plugin notification support.
 */

import type { PluginModule } from '@hamak/microkernel-spi';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
}

const NOTIFICATION_TOKEN = Symbol('NotificationService');

class SimpleNotificationService {
  private listeners: Array<(notification: Notification) => void> = [];
  private counter = 0;

  notify(type: NotificationType, message: string, duration = 5000): void {
    const notification: Notification = {
      id: `notif-${++this.counter}`,
      type,
      message,
      duration,
    };
    this.listeners.forEach((fn) => fn(notification));
  }

  subscribe(listener: (notification: Notification) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }

  success(message: string) { this.notify('success', message); }
  error(message: string) { this.notify('error', message); }
  warning(message: string) { this.notify('warning', message); }
  info(message: string) { this.notify('info', message); }
}

export function createNotificationPlugin(): PluginModule {
  const service = new SimpleNotificationService();

  return {
    async initialize(ctx) {
      ctx.provide({ provide: NOTIFICATION_TOKEN, useValue: service });

      // Register notification commands
      ctx.commands.register('notification.success', (message: string) => service.success(message));
      ctx.commands.register('notification.error', (message: string) => service.error(message));
      ctx.commands.register('notification.warning', (message: string) => service.warning(message));
      ctx.commands.register('notification.info', (message: string) => service.info(message));
    },

    async activate() {
      console.log('[notification] Plugin activated');
    },
  };
}

export { NOTIFICATION_TOKEN, SimpleNotificationService };
