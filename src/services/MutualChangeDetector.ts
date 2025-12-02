/**
 * MutualChangeDetector
 * Compares mutual snapshots and detects changes (Phase 2-4)
 *
 * @purpose Detect unfollows and new mutuals by comparing snapshots
 * @used-by MutualChangeScheduler, FollowListSecondaryManager
 */

import { MutualService } from './MutualService';
import { MutualChangeStorage, MutualChange } from './storage/MutualChangeStorage';
import { EventBus } from './EventBus';
import { SystemLogger } from '../components/system/SystemLogger';
import { AuthService } from './AuthService';
import type { NostrEvent } from '@nostr-dev-kit/ndk';

export interface DetectionResult {
  unfollows: string[];
  newMutuals: string[];
  totalChanges: number;
  durationMs: number;
  isFirstCheck: boolean;
}

export class MutualChangeDetector {
  private static instance: MutualChangeDetector;
  private mutualService: MutualService;
  private storage: MutualChangeStorage;
  private eventBus: EventBus;
  private systemLogger: SystemLogger;
  private authService: AuthService;

  private constructor() {
    this.mutualService = MutualService.getInstance();
    this.storage = MutualChangeStorage.getInstance();
    this.eventBus = EventBus.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.authService = AuthService.getInstance();
  }

  public static getInstance(): MutualChangeDetector {
    if (!MutualChangeDetector.instance) {
      MutualChangeDetector.instance = new MutualChangeDetector();
    }
    return MutualChangeDetector.instance;
  }

  /**
   * Perform detection: compare current mutuals with snapshot
   * @returns Detection result with unfollows, new mutuals, and timing
   */
  public async detect(): Promise<DetectionResult> {
    const startTime = Date.now();
    const currentUser = this.authService.getCurrentUser();

    if (!currentUser) {
      this.systemLogger.warn('MutualChangeDetector', 'No user logged in, skipping detection');
      return { unfollows: [], newMutuals: [], totalChanges: 0, durationMs: 0, isFirstCheck: true };
    }

    this.systemLogger.info('MutualChangeDetector', 'Starting mutual change detection...');

    try {
      // Step 1: Get current mutuals from MutualService
      const follows = await this.mutualService.getFollowsForMutualCheck();
      const followsWithStatus = await this.mutualService.checkMutualStatusBatch(follows);
      const currentMutualPubkeys = followsWithStatus
        .filter(f => f.isMutual)
        .map(f => f.pubkey);

      this.systemLogger.info('MutualChangeDetector', `Current mutuals: ${currentMutualPubkeys.length}`);

      // Step 2: Get previous snapshot
      const previousSnapshot = this.storage.getSnapshot();

      // First check: no previous snapshot
      if (!previousSnapshot) {
        this.systemLogger.info('MutualChangeDetector', 'First check - saving initial snapshot');
        this.storage.saveSnapshot(currentMutualPubkeys);
        await this.storage.saveToFile();

        const durationMs = Date.now() - startTime;
        return { unfollows: [], newMutuals: [], totalChanges: 0, durationMs, isFirstCheck: true };
      }

      // Step 3: Compare snapshots
      const previousMutuals = new Set(previousSnapshot.mutualPubkeys);
      const currentMutuals = new Set(currentMutualPubkeys);

      // Unfollows: in previous but NOT in current
      const unfollows = previousSnapshot.mutualPubkeys.filter(
        pubkey => !currentMutuals.has(pubkey)
      );

      // New mutuals: in current but NOT in previous
      const newMutuals = currentMutualPubkeys.filter(
        pubkey => !previousMutuals.has(pubkey)
      );

      const totalChanges = unfollows.length + newMutuals.length;
      const durationMs = Date.now() - startTime;

      this.systemLogger.info('MutualChangeDetector',
        `Detection complete: ${unfollows.length} unfollows, ${newMutuals.length} new mutuals (${durationMs}ms)`
      );

      // Step 4: If changes detected, process them
      if (totalChanges > 0) {
        await this.processChanges(unfollows, newMutuals, currentUser.pubkey);
      }

      // Step 5: Update snapshot
      this.storage.saveSnapshot(currentMutualPubkeys);

      // Step 6: Add history entry and save to file
      await this.storage.addHistoryEntry({
        timestamp: Date.now(),
        unfollowCount: unfollows.length,
        newMutualCount: newMutuals.length,
        durationMs
      });
      await this.storage.saveToFile();

      return { unfollows, newMutuals, totalChanges, durationMs, isFirstCheck: false };
    } catch (error) {
      this.systemLogger.error('MutualChangeDetector', `Detection failed: ${error}`);
      return { unfollows: [], newMutuals: [], totalChanges: 0, durationMs: Date.now() - startTime, isFirstCheck: false };
    }
  }

  /**
   * Process detected changes: store and create notifications
   */
  private async processChanges(
    unfollows: string[],
    newMutuals: string[],
    currentUserPubkey: string
  ): Promise<void> {
    const now = Date.now();
    const changes: MutualChange[] = [];

    // Create unfollow changes
    for (const pubkey of unfollows) {
      changes.push({
        pubkey,
        type: 'unfollow',
        detectedAt: now
      });

      // Create synthetic notification
      this.injectNotification(pubkey, 'mutual_unfollow', currentUserPubkey);
    }

    // Create new mutual changes
    for (const pubkey of newMutuals) {
      changes.push({
        pubkey,
        type: 'new_mutual',
        detectedAt: now
      });

      // Create synthetic notification
      this.injectNotification(pubkey, 'mutual_new', currentUserPubkey);
    }

    // Store changes
    this.storage.addChanges(changes);

    // Emit event for UI updates (green dot)
    this.eventBus.emit('mutual-changes:detected', {
      unfollowCount: unfollows.length,
      newMutualCount: newMutuals.length
    });

    this.systemLogger.info('MutualChangeDetector', `Processed ${changes.length} changes, notifications injected`);
  }

  /**
   * Inject synthetic notification into NotificationsOrchestrator
   */
  private injectNotification(
    pubkey: string,
    type: 'mutual_unfollow' | 'mutual_new',
    currentUserPubkey: string
  ): void {
    // Create synthetic NostrEvent (not published to relays)
    const syntheticEvent: NostrEvent = {
      id: `mutual-${type}-${pubkey}-${Date.now()}`,
      pubkey: pubkey, // The person who unfollowed/followed
      kind: 99001, // Custom kind for mutual changes
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['type', type],
        ['p', currentUserPubkey]
      ],
      content: '',
      sig: '' // Empty - synthetic event
    };

    // Emit notification event (NotificationsOrchestrator listens)
    this.eventBus.emit('mutual-notification:new', {
      event: syntheticEvent,
      type
    });
  }

  /**
   * Get detected changes (for UI display)
   */
  public getChanges(): MutualChange[] {
    return this.storage.getChanges();
  }

  /**
   * Clear changes (after user has seen them)
   */
  public markAsSeen(): void {
    this.storage.clearChanges();
    this.eventBus.emit('mutual-changes:seen');
  }

  /**
   * Check if there are unseen changes
   */
  public hasUnseenChanges(): boolean {
    return this.storage.hasUnseenChanges();
  }
}
