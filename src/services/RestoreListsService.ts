/**
 * RestoreListsService
 * Cascading restore logic for lists (Follows, Bookmarks, Mutes)
 *
 * Priority:
 * 1. Browser storage (localStorage) - fastest, session state
 * 2. Local file (~/.noornote/*.json) - offline, has folder structure
 * 3. Relays - network, NIP-51 events
 *
 * @purpose Restore empty lists from local file or relays
 * @used-by BookmarkSecondaryManager, MuteListSecondaryManager, FollowListSecondaryManager
 */

import { ListSyncManager } from './sync/ListSyncManager';

export interface RestoreResult {
  source: 'browser' | 'file' | 'relays' | 'empty';
  itemCount: number;
}

export class RestoreListsService {
  private static instance: RestoreListsService;

  private constructor() {}

  public static getInstance(): RestoreListsService {
    if (!RestoreListsService.instance) {
      RestoreListsService.instance = new RestoreListsService();
    }
    return RestoreListsService.instance;
  }

  /**
   * Restore a list using cascading logic
   *
   * @param listSyncManager - The list's sync manager
   * @param getBrowserItems - Function to get current browser items
   * @param setBrowserItems - Function to set browser items
   * @param listName - Name for logging (e.g., 'bookmarks', 'mutes', 'follows')
   * @param beforeFileRestore - Optional callback before file restore (e.g., restore folder data)
   * @returns RestoreResult with source and item count
   */
  public async restoreIfEmpty<T>(
    listSyncManager: ListSyncManager<T>,
    getBrowserItems: () => T[],
    _setBrowserItems: (items: T[]) => void,
    listName: string,
    beforeFileRestore?: () => Promise<void>
  ): Promise<RestoreResult> {
    // Step 1: Check browser storage
    let items = getBrowserItems();
    if (items.length > 0) {
      return { source: 'browser', itemCount: items.length };
    }

    console.log(`[RestoreListsService] ${listName}: Browser storage empty, trying local file...`);

    // Step 2: Try local file
    try {
      if (beforeFileRestore) {
        await beforeFileRestore();
      }

      const restored = await listSyncManager.restoreFromFile();
      if (restored) {
        items = getBrowserItems();
        if (items.length > 0) {
          console.log(`[RestoreListsService] ${listName}: Restored ${items.length} items from local file`);
          return { source: 'file', itemCount: items.length };
        }
      }
    } catch (_error) {
      console.warn(`[RestoreListsService] ${listName}: Failed to restore from local file:`, _error);
    }

    console.log(`[RestoreListsService] ${listName}: Local file empty, trying relays...`);

    // Step 3: Try relays
    try {
      const result = await listSyncManager.syncFromRelays();
      if (result.relayItems.length > 0) {
        // Apply relay items to browser storage
        await listSyncManager.applySyncFromRelays('merge', result.relayItems, result.relayContentWasEmpty);
        items = getBrowserItems();
        if (items.length > 0) {
          console.log(`[RestoreListsService] ${listName}: Restored ${items.length} items from relays`);
          return { source: 'relays', itemCount: items.length };
        }
      }
    } catch (_error) {
      console.warn(`[RestoreListsService] ${listName}: Failed to fetch from relays:`, _error);
    }

    // Step 4: List is truly empty
    console.log(`[RestoreListsService] ${listName}: List is empty (no data in browser, file, or relays)`);
    return { source: 'empty', itemCount: 0 };
  }
}
