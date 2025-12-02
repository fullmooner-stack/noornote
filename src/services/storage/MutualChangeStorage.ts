/**
 * MutualChangeStorage
 * Dual-layer storage for mutual change detection (Phase 2-4)
 *
 * Architecture:
 * - File (~/.noornote/{npub}/mutual-check-data.json) = Source of Truth
 * - localStorage = Runtime cache for fast access
 *
 * @purpose Store mutual snapshots and detected changes
 * @used-by MutualChangeDetector, MutualChangeScheduler, FollowListSecondaryManager
 */

import { BaseFileStorage, BaseFileData } from './BaseFileStorage';

export interface MutualSnapshot {
  timestamp: number;
  mutualPubkeys: string[];
}

export interface MutualChange {
  pubkey: string;
  type: 'unfollow' | 'new_mutual';
  detectedAt: number;
}

export interface CheckHistoryEntry {
  timestamp: number;
  unfollowCount: number;
  newMutualCount: number;
  durationMs: number;
}

export interface MutualCheckData extends BaseFileData {
  version: number;
  snapshot: MutualSnapshot | null;
  lastCheckTimestamp: number | null;
  unseenChanges: boolean;
  changes: MutualChange[];
  checkHistory: CheckHistoryEntry[];
}

// localStorage keys (runtime cache)
const LS_SNAPSHOT = 'noornote_mutual_snapshot';
const LS_LAST_CHECK = 'noornote_mutual_last_check';
const LS_UNSEEN_CHANGES = 'noornote_mutual_unseen_changes';
const LS_CHANGES = 'noornote_mutual_changes';

export class MutualChangeStorage extends BaseFileStorage<MutualCheckData> {
  private static instance: MutualChangeStorage;

  private constructor() {
    super();
  }

  public static getInstance(): MutualChangeStorage {
    if (!MutualChangeStorage.instance) {
      MutualChangeStorage.instance = new MutualChangeStorage();
    }
    return MutualChangeStorage.instance;
  }

  protected getFileName(): string {
    return 'mutual-check-data.json';
  }

  protected getLoggerName(): string {
    return 'MutualChangeStorage';
  }

  protected getDefaultData(): MutualCheckData {
    return {
      version: 1,
      lastModified: Math.floor(Date.now() / 1000),
      snapshot: null,
      lastCheckTimestamp: null,
      unseenChanges: false,
      changes: [],
      checkHistory: []
    };
  }

  /**
   * Initialize from file on app startup
   * Populates localStorage cache from file
   */
  public async initFromFile(): Promise<void> {
    try {
      await this.initialize();
      const data = await this.read();

      // Populate localStorage cache
      if (data.snapshot) {
        localStorage.setItem(LS_SNAPSHOT, JSON.stringify(data.snapshot));
      }
      if (data.lastCheckTimestamp) {
        localStorage.setItem(LS_LAST_CHECK, data.lastCheckTimestamp.toString());
      }
      localStorage.setItem(LS_UNSEEN_CHANGES, data.unseenChanges ? 'true' : 'false');
      if (data.changes.length > 0) {
        localStorage.setItem(LS_CHANGES, JSON.stringify(data.changes));
      }

      this.systemLogger.info(this.getLoggerName(), 'Initialized from file, localStorage populated');
    } catch (error) {
      this.systemLogger.error(this.getLoggerName(), `Failed to init from file: ${error}`);
    }
  }

  /**
   * Save current state to both localStorage AND file
   */
  public async saveToFile(): Promise<void> {
    try {
      const data = this.collectFromLocalStorage();
      await this.write(data);
      this.systemLogger.info(this.getLoggerName(), 'Saved to file');
    } catch (error) {
      this.systemLogger.error(this.getLoggerName(), `Failed to save to file: ${error}`);
    }
  }

  /**
   * Collect current state from localStorage
   */
  private collectFromLocalStorage(): MutualCheckData {
    const snapshotStr = localStorage.getItem(LS_SNAPSHOT);
    const lastCheckStr = localStorage.getItem(LS_LAST_CHECK);
    const unseenStr = localStorage.getItem(LS_UNSEEN_CHANGES);
    const changesStr = localStorage.getItem(LS_CHANGES);

    return {
      version: 1,
      lastModified: Math.floor(Date.now() / 1000),
      snapshot: snapshotStr ? JSON.parse(snapshotStr) : null,
      lastCheckTimestamp: lastCheckStr ? parseInt(lastCheckStr, 10) : null,
      unseenChanges: unseenStr === 'true',
      changes: changesStr ? JSON.parse(changesStr) : [],
      checkHistory: [] // History only in file, not needed in runtime
    };
  }

  // ========== Snapshot Methods (localStorage) ==========

  /**
   * Get current snapshot from localStorage
   */
  public getSnapshot(): MutualSnapshot | null {
    const stored = localStorage.getItem(LS_SNAPSHOT);
    return stored ? JSON.parse(stored) : null;
  }

  /**
   * Save new snapshot to localStorage
   */
  public saveSnapshot(mutualPubkeys: string[]): void {
    const snapshot: MutualSnapshot = {
      timestamp: Date.now(),
      mutualPubkeys
    };
    localStorage.setItem(LS_SNAPSHOT, JSON.stringify(snapshot));
    localStorage.setItem(LS_LAST_CHECK, Date.now().toString());
  }

  /**
   * Get last check timestamp
   */
  public getLastCheckTimestamp(): number | null {
    const stored = localStorage.getItem(LS_LAST_CHECK);
    return stored ? parseInt(stored, 10) : null;
  }

  // ========== Changes Methods (localStorage) ==========

  /**
   * Get current changes
   */
  public getChanges(): MutualChange[] {
    const stored = localStorage.getItem(LS_CHANGES);
    return stored ? JSON.parse(stored) : [];
  }

  /**
   * Add detected changes
   */
  public addChanges(changes: MutualChange[]): void {
    const existing = this.getChanges();
    const combined = [...existing, ...changes];
    localStorage.setItem(LS_CHANGES, JSON.stringify(combined));

    if (changes.length > 0) {
      this.setUnseenChanges(true);
    }
  }

  /**
   * Clear all changes (after "Mark as Seen")
   */
  public clearChanges(): void {
    localStorage.removeItem(LS_CHANGES);
    this.setUnseenChanges(false);
  }

  // ========== Unseen Changes Flag ==========

  /**
   * Check if there are unseen changes (for green dot)
   */
  public hasUnseenChanges(): boolean {
    return localStorage.getItem(LS_UNSEEN_CHANGES) === 'true';
  }

  /**
   * Set unseen changes flag
   */
  public setUnseenChanges(value: boolean): void {
    localStorage.setItem(LS_UNSEEN_CHANGES, value ? 'true' : 'false');
  }

  // ========== History Methods (file only) ==========

  /**
   * Add check history entry (saved to file only)
   */
  public async addHistoryEntry(entry: CheckHistoryEntry): Promise<void> {
    try {
      const data = await this.read();
      data.checkHistory.push(entry);

      // Keep only last 50 entries
      if (data.checkHistory.length > 50) {
        data.checkHistory = data.checkHistory.slice(-50);
      }

      await this.write(data);
    } catch (error) {
      this.systemLogger.error(this.getLoggerName(), `Failed to add history entry: ${error}`);
    }
  }

  // ========== Clear Methods ==========

  /**
   * Clear localStorage cache (on logout)
   */
  public clearLocalStorage(): void {
    localStorage.removeItem(LS_SNAPSHOT);
    localStorage.removeItem(LS_LAST_CHECK);
    localStorage.removeItem(LS_UNSEEN_CHANGES);
    localStorage.removeItem(LS_CHANGES);
  }

  /**
   * Full reset (localStorage + reinitialize file state)
   */
  public reset(): void {
    this.clearLocalStorage();
    this.resetInitialization();
  }
}

// Debug helper (exposed on window for DevTools)
if (typeof window !== 'undefined') {
  (window as any).__MUTUAL_CHANGE_STORAGE__ = {
    logState: () => {
      const storage = MutualChangeStorage.getInstance();
      console.log('=== MutualChangeStorage State ===');
      console.log('Snapshot:', storage.getSnapshot());
      console.log('Last Check:', storage.getLastCheckTimestamp());
      console.log('Unseen Changes:', storage.hasUnseenChanges());
      console.log('Changes:', storage.getChanges());
    }
  };
}
