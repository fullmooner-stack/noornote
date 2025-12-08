/**
 * Notifications Cache Service
 * Manages localStorage cache for notifications (fast reload on view switches)
 *
 * Features:
 * - Cache notifications in localStorage
 * - Track lastSeen (for badge calculation)
 * - Track lastFetch (for incremental updates)
 * - FIFO queue (max X notifications, configurable)
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';

interface NotificationsCache {
  events: NostrEvent[];
  lastSeen: number;      // Unix timestamp (last time user opened NV)
  lastFetch: number;     // Unix timestamp (last fetch time)
}

export class NotificationsCacheService {
  private static instance: NotificationsCacheService;
  private cacheKey = 'noornote_notifications_cache';
  private limitKey = 'noornote_notifications_cache_limit';
  private defaultLimit = 100;

  private constructor() {}

  public static getInstance(): NotificationsCacheService {
    if (!NotificationsCacheService.instance) {
      NotificationsCacheService.instance = new NotificationsCacheService();
    }
    return NotificationsCacheService.instance;
  }

  /**
   * Get cache limit (user-configurable in Settings)
   */
  public getLimit(): number {
    try {
      const stored = localStorage.getItem(this.limitKey);
      if (stored) {
        const limit = parseInt(stored, 10);
        return limit > 0 ? limit : this.defaultLimit;
      }
    } catch (error) {
      console.error('Failed to load cache limit:', error);
    }
    return this.defaultLimit;
  }

  /**
   * Set cache limit
   */
  public setLimit(limit: number): void {
    try {
      localStorage.setItem(this.limitKey, limit.toString());
    } catch (error) {
      console.error('Failed to save cache limit:', error);
    }
  }

  /**
   * Load cache from localStorage
   */
  public loadCache(): NotificationsCache | null {
    try {
      const stored = localStorage.getItem(this.cacheKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load notifications cache:', error);
    }
    return null;
  }

  /**
   * Save cache to localStorage
   */
  public saveCache(cache: NotificationsCache): void {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.error('Failed to save notifications cache:', error);
    }
  }

  /**
   * Update lastSeen timestamp (called when user opens NV)
   */
  public updateLastSeen(): void {
    const now = Math.floor(Date.now() / 1000);
    const cache = this.loadCache();
    if (cache) {
      cache.lastSeen = now;
      this.saveCache(cache);
    } else {
      // Initialize cache if not exists
      this.saveCache({
        events: [],
        lastSeen: now,
        lastFetch: 0
      });
    }

    // Also update NotificationsOrchestrator's lastSeen (for badge count)
    localStorage.setItem('noornote_notifications_last_seen', now.toString());
  }

  /**
   * Get lastSeen timestamp
   */
  public getLastSeen(): number {
    const cache = this.loadCache();
    return cache?.lastSeen || 0;
  }

  /**
   * Get lastFetch timestamp
   */
  public getLastFetch(): number {
    const cache = this.loadCache();
    return cache?.lastFetch || 0;
  }

  /**
   * Add new notifications to cache (FIFO queue)
   * Merges with existing, sorts by created_at DESC, keeps only newest X
   */
  public addNotifications(newEvents: NostrEvent[]): void {
    const cache = this.loadCache() || {
      events: [],
      lastSeen: Math.floor(Date.now() / 1000),
      lastFetch: 0
    };

    // Merge new events with existing (deduplicate by id)
    const eventMap = new Map<string, NostrEvent>();

    // Add existing events
    cache.events.forEach(event => eventMap.set(event.id, event));

    // Add/overwrite with new events
    newEvents.forEach(event => eventMap.set(event.id, event));

    // Convert to array and sort by created_at DESC (newest first)
    const allEvents = Array.from(eventMap.values())
      .sort((a, b) => b.created_at - a.created_at);

    // Keep only newest X events (FIFO)
    const limit = this.getLimit();
    cache.events = allEvents.slice(0, limit);

    // Update lastFetch
    cache.lastFetch = Math.floor(Date.now() / 1000);

    this.saveCache(cache);
  }

  /**
   * Get cached notifications
   */
  public getCachedNotifications(): NostrEvent[] {
    const cache = this.loadCache();
    return cache?.events || [];
  }

  /**
   * Get count of new notifications since lastSeen (for badge)
   */
  public getNewCount(): number {
    const cache = this.loadCache();
    if (!cache) return 0;

    return cache.events.filter(event => event.created_at > cache.lastSeen).length;
  }

  /**
   * Clear cache
   */
  public clearCache(): void {
    try {
      localStorage.removeItem(this.cacheKey);
    } catch (error) {
      console.error('Failed to clear notifications cache:', error);
    }
  }

  /**
   * Initialize cache (called on first NV visit)
   */
  public initializeCache(): void {
    const existing = this.loadCache();
    if (!existing) {
      this.saveCache({
        events: [],
        lastSeen: Math.floor(Date.now() / 1000),
        lastFetch: 0
      });
    }
  }
}
