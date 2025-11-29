/**
 * ConnectivityService - Internet Connection Monitor
 * Checks and monitors internet connectivity status
 *
 * @purpose Detect offline state early to prevent cascade of errors
 * @architecture Singleton service, integrates with EventBus
 */

import { EventBus } from './EventBus';

export class ConnectivityService {
  private static instance: ConnectivityService;
  private eventBus: EventBus;
  private _isOnline: boolean = true;
  private checkInProgress: boolean = false;

  private constructor() {
    this.eventBus = EventBus.getInstance();
    this.setupBrowserListeners();
    this.setupRelayListeners();
  }

  public static getInstance(): ConnectivityService {
    if (!ConnectivityService.instance) {
      ConnectivityService.instance = new ConnectivityService();
    }
    return ConnectivityService.instance;
  }

  /**
   * Check if currently online
   */
  public isOnline(): boolean {
    return this._isOnline;
  }

  /**
   * Perform initial connectivity check
   * Returns true if online, false if offline
   */
  public async checkConnectivity(): Promise<boolean> {
    if (this.checkInProgress) {
      return this._isOnline;
    }

    this.checkInProgress = true;

    try {
      // First check browser's online status
      if (!navigator.onLine) {
        this.setOnlineStatus(false);
        return false;
      }

      // Verify with actual network request (browser onLine can be unreliable)
      const isReachable = await this.verifyNetworkReachability();
      this.setOnlineStatus(isReachable);
      return isReachable;
    } finally {
      this.checkInProgress = false;
    }
  }

  /**
   * Verify network reachability with actual request
   * Uses multiple endpoints for reliability
   */
  private async verifyNetworkReachability(): Promise<boolean> {
    const testEndpoints = [
      'https://www.google.com/generate_204',
      'https://connectivity-check.ubuntu.com/',
      'https://1.1.1.1/cdn-cgi/trace'
    ];

    for (const endpoint of testEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        await fetch(endpoint, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // no-cors mode returns opaque response, but if we get here without error, we're online
        return true;
      } catch {
        // Try next endpoint
        continue;
      }
    }

    return false;
  }

  /**
   * Set online status and emit event if changed
   */
  private setOnlineStatus(online: boolean): void {
    const wasOnline = this._isOnline;
    this._isOnline = online;

    if (wasOnline !== online) {
      this.eventBus.emit('connectivity:status', { online });
    }
  }

  /**
   * Setup browser online/offline event listeners
   */
  private setupBrowserListeners(): void {
    window.addEventListener('online', () => {
      // Browser reports online - verify with actual check
      this.checkConnectivity();
    });

    window.addEventListener('offline', () => {
      // Browser reports offline - trust immediately
      this.setOnlineStatus(false);
    });
  }

  /**
   * Listen to relay connection events from RelayHealthMonitor
   * If a relay connects while we think we're offline, verify connectivity
   */
  private setupRelayListeners(): void {
    this.eventBus.on('relay:connected', () => {
      // Relay connected - if we were offline, verify internet connectivity
      if (!this._isOnline) {
        this.checkConnectivity();
      }
    });
  }
}
