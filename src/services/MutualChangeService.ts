/**
 * MutualChangeService
 * Self-initializing service for mutual change detection (Phase 2-4)
 *
 * Architecture:
 * - Listens to user:login / user:logout via EventBus
 * - Delayed start: 3 minutes after login
 * - Stops on logout
 * - Completely decoupled from App.ts
 *
 * @purpose Orchestrate mutual change detection lifecycle
 * @used-by Automatically initializes on import
 */

import { EventBus } from './EventBus';
import { MutualChangeStorage } from './storage/MutualChangeStorage';
import { MutualChangeScheduler } from './MutualChangeScheduler';
import { SystemLogger } from '../components/system/SystemLogger';

const DELAYED_START_MS = 3 * 60 * 1000; // 3 minutes

class MutualChangeServiceImpl {
  private eventBus: EventBus;
  private storage: MutualChangeStorage;
  private scheduler: MutualChangeScheduler;
  private systemLogger: SystemLogger;
  private delayedStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private isInitialized: boolean = false;

  constructor() {
    this.eventBus = EventBus.getInstance();
    this.storage = MutualChangeStorage.getInstance();
    this.scheduler = MutualChangeScheduler.getInstance();
    this.systemLogger = SystemLogger.getInstance();

    this.setupEventListeners();
    this.systemLogger.info('MutualChangeService', 'Service initialized, waiting for login...');
  }

  private setupEventListeners(): void {
    // Start on login (with delay)
    this.eventBus.on('user:login', () => {
      this.handleLogin();
    });

    // Stop on logout
    this.eventBus.on('user:logout', () => {
      this.handleLogout();
    });
  }

  private handleLogin(): void {
    // Cancel any pending delayed start
    if (this.delayedStartTimeout) {
      clearTimeout(this.delayedStartTimeout);
    }

    this.systemLogger.info('MutualChangeService', `User logged in, scheduling start in ${DELAYED_START_MS / 1000 / 60} minutes...`);

    // Delayed start to avoid impacting startup performance
    this.delayedStartTimeout = setTimeout(async () => {
      await this.start();
    }, DELAYED_START_MS);
  }

  private handleLogout(): void {
    // Cancel pending delayed start
    if (this.delayedStartTimeout) {
      clearTimeout(this.delayedStartTimeout);
      this.delayedStartTimeout = null;
    }

    // Stop scheduler
    this.scheduler.stop();

    // Clear localStorage cache
    this.storage.clearLocalStorage();

    this.isInitialized = false;
    this.systemLogger.info('MutualChangeService', 'Stopped on logout');
  }

  private async start(): Promise<void> {
    if (this.isInitialized) {
      this.systemLogger.info('MutualChangeService', 'Already initialized, skipping');
      return;
    }

    try {
      // Initialize storage from file
      await this.storage.initFromFile();

      // Start scheduler
      await this.scheduler.start();

      this.isInitialized = true;
      this.systemLogger.info('MutualChangeService', 'Started successfully');
    } catch (error) {
      this.systemLogger.error('MutualChangeService', `Failed to start: ${error}`);
    }
  }
}

// Auto-initialize singleton on import
export const MutualChangeService = new MutualChangeServiceImpl();
