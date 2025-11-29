/**
 * OfflineOverlay - Fullscreen Offline State Display
 * Shows when no internet connection is detected
 *
 * @purpose Block app usage and show clear message when offline
 * @architecture Singleton component, controlled by App.ts
 */

import { EventBus } from '../../services/EventBus';
import { ConnectivityService } from '../../services/ConnectivityService';

export class OfflineOverlay {
  private static instance: OfflineOverlay;
  private element: HTMLElement;
  private eventBus: EventBus;
  private connectivityService: ConnectivityService;
  private isVisible: boolean = false;
  private retryInProgress: boolean = false;

  private constructor() {
    this.eventBus = EventBus.getInstance();
    this.connectivityService = ConnectivityService.getInstance();
    this.element = this.createElement();
    this.setupEventListeners();
  }

  public static getInstance(): OfflineOverlay {
    if (!OfflineOverlay.instance) {
      OfflineOverlay.instance = new OfflineOverlay();
    }
    return OfflineOverlay.instance;
  }

  /**
   * Create the overlay DOM element
   */
  private createElement(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'offline-overlay';
    overlay.innerHTML = `
      <div class="offline-overlay__content">
        <div class="offline-overlay__icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
          </svg>
        </div>
        <h2 class="offline-overlay__title">No Internet Connection</h2>
        <p class="offline-overlay__message">Please check your network connection and try again.</p>
        <button class="offline-overlay__retry btn btn-primary">
          <span class="offline-overlay__retry-text">Retry</span>
          <span class="offline-overlay__retry-spinner"></span>
        </button>
      </div>
    `;

    // Retry button handler
    const retryBtn = overlay.querySelector('.offline-overlay__retry');
    retryBtn?.addEventListener('click', () => this.handleRetry());

    return overlay;
  }

  /**
   * Setup event listeners for connectivity changes
   */
  private setupEventListeners(): void {
    this.eventBus.on('connectivity:status', (data: { online: boolean }) => {
      if (data.online && this.isVisible) {
        this.hide();
        // Reload app to reinitialize everything
        window.location.reload();
      }
    });
  }

  /**
   * Handle retry button click
   */
  private async handleRetry(): Promise<void> {
    if (this.retryInProgress) return;

    this.retryInProgress = true;
    this.element.classList.add('offline-overlay--retrying');

    const isOnline = await this.connectivityService.checkConnectivity();

    this.retryInProgress = false;
    this.element.classList.remove('offline-overlay--retrying');

    if (isOnline) {
      this.hide();
      window.location.reload();
    }
  }

  /**
   * Show the overlay
   */
  public show(): void {
    if (this.isVisible) return;

    document.body.appendChild(this.element);
    // Trigger animation
    requestAnimationFrame(() => {
      this.element.classList.add('offline-overlay--visible');
    });
    this.isVisible = true;
  }

  /**
   * Hide the overlay
   */
  public hide(): void {
    if (!this.isVisible) return;

    this.element.classList.remove('offline-overlay--visible');
    setTimeout(() => {
      this.element.remove();
    }, 300);
    this.isVisible = false;
  }

  /**
   * Check if overlay is currently visible
   */
  public isShowing(): boolean {
    return this.isVisible;
  }
}
