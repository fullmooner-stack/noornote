/**
 * MutualChangeScheduler
 * Background scheduler for automatic mutual change detection (Phase 4)
 *
 * Architecture:
 * - Delayed start: 3 minutes after login (not immediate)
 * - Check interval: Every 4 hours (if app stays open)
 * - Checks immediately on start if last check was >4h ago
 *
 * @purpose Automate mutual change detection without impacting startup
 * @used-by App.ts (started after login)
 */

import { MutualChangeDetector } from './MutualChangeDetector';
import { MutualChangeStorage } from './storage/MutualChangeStorage';
import { SystemLogger } from '../components/system/SystemLogger';
import { AuthService } from './AuthService';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class MutualChangeScheduler {
  private static instance: MutualChangeScheduler;
  private detector: MutualChangeDetector;
  private storage: MutualChangeStorage;
  private systemLogger: SystemLogger;
  private authService: AuthService;

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private lastCheckAttempt: number | null = null;

  private constructor() {
    this.detector = MutualChangeDetector.getInstance();
    this.storage = MutualChangeStorage.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.authService = AuthService.getInstance();
  }

  public static getInstance(): MutualChangeScheduler {
    if (!MutualChangeScheduler.instance) {
      MutualChangeScheduler.instance = new MutualChangeScheduler();
    }
    return MutualChangeScheduler.instance;
  }

  /**
   * Start the scheduler
   * Called 3 minutes after login (delayed start in App.ts)
   */
  public async start(): Promise<void> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      this.systemLogger.warn('MutualChangeScheduler', 'Cannot start - no user logged in');
      return;
    }

    if (this.isRunning) {
      this.systemLogger.info('MutualChangeScheduler', 'Already running, skipping start');
      return;
    }

    this.isRunning = true;
    this.systemLogger.info('MutualChangeScheduler', '🚀 Starting scheduler...');

    // Check immediately if due
    await this.checkIfDue();

    // Then schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.checkIfDue();
    }, CHECK_INTERVAL_MS);

    this.systemLogger.info('MutualChangeScheduler', `✅ Scheduler started (interval: ${CHECK_INTERVAL_MS / 1000 / 60 / 60}h)`);
  }

  /**
   * Stop the scheduler (called on logout)
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    this.lastCheckAttempt = null;
    this.systemLogger.info('MutualChangeScheduler', '🛑 Scheduler stopped');
  }

  /**
   * Check if a detection is due (>4h since last check)
   */
  private async checkIfDue(): Promise<void> {
    const lastCheck = this.storage.getLastCheckTimestamp();
    const now = Date.now();

    // First check ever, or >4h since last check
    if (!lastCheck || (now - lastCheck) > CHECK_INTERVAL_MS) {
      this.systemLogger.info('MutualChangeScheduler', 'Check is due, running detection...');
      this.lastCheckAttempt = now;

      try {
        const result = await this.detector.detect();

        if (result.totalChanges > 0) {
          this.systemLogger.info('MutualChangeScheduler',
            `✅ Detection complete: ${result.unfollows.length} unfollows, ${result.newMutuals.length} new mutuals`
          );
        } else if (result.isFirstCheck) {
          this.systemLogger.info('MutualChangeScheduler', '✅ Initial snapshot saved');
        } else {
          this.systemLogger.info('MutualChangeScheduler', '✅ No changes detected');
        }
      } catch (error) {
        this.systemLogger.error('MutualChangeScheduler', `Detection failed: ${error}`);
      }
    } else {
      const nextCheckIn = Math.round((CHECK_INTERVAL_MS - (now - lastCheck)) / 1000 / 60);
      this.systemLogger.info('MutualChangeScheduler', `Check not due yet (next in ~${nextCheckIn} min)`);
    }
  }

  /**
   * Force immediate check (for manual trigger / debugging)
   */
  public async forceCheck(): Promise<void> {
    this.systemLogger.info('MutualChangeScheduler', '⚡ Force check triggered');
    this.lastCheckAttempt = Date.now();

    try {
      const result = await this.detector.detect();
      this.systemLogger.info('MutualChangeScheduler',
        `✅ Force check complete: ${result.unfollows.length} unfollows, ${result.newMutuals.length} new mutuals (${result.durationMs}ms)`
      );
      return;
    } catch (error) {
      this.systemLogger.error('MutualChangeScheduler', `Force check failed: ${error}`);
    }
  }

  /**
   * Get scheduler status (for debugging)
   */
  public getStatus(): {
    isRunning: boolean;
    lastCheckAttempt: number | null;
    lastSuccessfulCheck: number | null;
    nextCheckDue: number | null;
  } {
    const lastCheck = this.storage.getLastCheckTimestamp();
    const nextCheckDue = lastCheck ? lastCheck + CHECK_INTERVAL_MS : null;

    return {
      isRunning: this.isRunning,
      lastCheckAttempt: this.lastCheckAttempt,
      lastSuccessfulCheck: lastCheck,
      nextCheckDue
    };
  }
}

// Debug helper (exposed on window for DevTools)
if (typeof window !== 'undefined') {
  (window as any).__MUTUAL_CHANGE_SCHEDULER__ = {
    forceCheck: () => MutualChangeScheduler.getInstance().forceCheck(),
    getStatus: () => {
      const status = MutualChangeScheduler.getInstance().getStatus();
      console.log('=== MutualChangeScheduler Status ===');
      console.log('Running:', status.isRunning);
      console.log('Last Check Attempt:', status.lastCheckAttempt ? new Date(status.lastCheckAttempt).toLocaleString() : 'Never');
      console.log('Last Successful Check:', status.lastSuccessfulCheck ? new Date(status.lastSuccessfulCheck).toLocaleString() : 'Never');
      console.log('Next Check Due:', status.nextCheckDue ? new Date(status.nextCheckDue).toLocaleString() : 'Unknown');
      return status;
    },
    stop: () => MutualChangeScheduler.getInstance().stop()
  };
}
