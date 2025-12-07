/**
 * CacheSettingsSection Component
 * Manages NDK cache configuration and clearing
 *
 * @purpose Configure NDK cache sizes and clear cache tables
 * @used-by SettingsView
 */

import { SettingsSection } from './SettingsSection';
import { ToastService } from '../../services/ToastService';
import { ErrorService } from '../../services/ErrorService';
import { ModalService } from '../../services/ModalService';
import { NotificationsCacheService } from '../../services/NotificationsCacheService';

interface NDKCacheConfig {
  profileCacheSize: number;
  zapperCacheSize: number;
  nip05CacheSize: number;
  eventCacheSize: number;
  eventTagsCacheSize: number;
  saveSig: boolean;
}

const DEFAULT_CONFIG: NDKCacheConfig = {
  profileCacheSize: 100000,
  zapperCacheSize: 200,
  nip05CacheSize: 1000,
  eventCacheSize: 50000,
  eventTagsCacheSize: 100000,
  saveSig: false
};

const STORAGE_KEY = 'ndk_cache_config';

export class CacheSettingsSection extends SettingsSection {
  private toastService: ToastService;
  private errorService: ErrorService;
  private modalService: ModalService;

  constructor() {
    super('cache-settings');
    this.toastService = ToastService.getInstance();
    this.errorService = ErrorService.getInstance();
    this.modalService = ModalService.getInstance();
  }

  /**
   * Get current cache configuration from localStorage
   */
  private getConfig(): NDKCacheConfig {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_CONFIG;

    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save cache configuration to localStorage
   */
  private saveConfig(config: NDKCacheConfig): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  /**
   * Mount section content into the DOM
   */
  public mount(parentContainer: HTMLElement): void {
    const contentContainer = this.getContentContainer(parentContainer);
    if (!contentContainer) return;

    const config = this.getConfig();
    const notificationsCacheService = NotificationsCacheService.getInstance();
    const notificationsCacheLimit = notificationsCacheService.getLimit();

    contentContainer.innerHTML = this.renderContent(config, notificationsCacheLimit);
    this.bindListeners(contentContainer);
  }

  /**
   * Render cache settings content
   */
  private renderContent(config: NDKCacheConfig, notificationsCacheLimit: number): string {
    return `
      <div class="cache-settings">
        <h3 class="subsection-title">Notifications Cache</h3>
        <div class="form__row form__row--oneline">
          <label for="notifications-cache-size">Cache Size</label>
          <input
            type="number"
            id="notifications-cache-size"
            value="${notificationsCacheLimit}"
            min="10"
            max="1000"
            step="10"
          />
        </div>
        <p class="form__note">Maximum notifications to keep in localStorage (10-1000).</p>

        <h3 class="subsection-title">NDK Cache Configuration</h3>
        <div class="form__info">
          <p>Configure NDK cache sizes. Changes require app reload to take effect.</p>
        </div>

        <div class="form__row form__row--oneline">
          <label for="profile-cache-size">Profile Cache Size</label>
          <input
            type="number"
            id="profile-cache-size"
            value="${config.profileCacheSize}"
            min="1000"
            max="500000"
            step="1000"
          />
        </div>

        <div class="form__row form__row--oneline">
          <label for="event-cache-size">Event Cache Size</label>
          <input
            type="number"
            id="event-cache-size"
            value="${config.eventCacheSize}"
            min="1000"
            max="200000"
            step="1000"
          />
        </div>

        <div class="form__row form__row--oneline">
          <label for="event-tags-cache-size">Event Tags Cache Size</label>
          <input
            type="number"
            id="event-tags-cache-size"
            value="${config.eventTagsCacheSize}"
            min="1000"
            max="500000"
            step="1000"
          />
        </div>

        <div class="form__row form__row--oneline">
          <label for="zapper-cache-size">Zapper Cache Size</label>
          <input
            type="number"
            id="zapper-cache-size"
            value="${config.zapperCacheSize}"
            min="50"
            max="5000"
            step="50"
          />
        </div>

        <div class="form__row form__row--oneline">
          <label for="nip05-cache-size">NIP-05 Cache Size</label>
          <input
            type="number"
            id="nip05-cache-size"
            value="${config.nip05CacheSize}"
            min="100"
            max="10000"
            step="100"
          />
        </div>

        <div class="form__row form__row--oneline">
          <label for="save-sig">Save Event Signatures</label>
          <input
            type="checkbox"
            id="save-sig"
            ${config.saveSig ? 'checked' : ''}
          />
        </div>
        <p class="form__note">Store signatures in cache (increases storage usage).</p>

        <div class="settings-section__actions">
          <button class="btn btn--medium" id="save-cache-config-btn">Save Configuration</button>
          <div id="cache-config-message" class="settings-section__action-feedback"></div>
        </div>

        <h3 class="subsection-title">Clear Cache Data</h3>
        <div class="form__info">
          <p>Select which cache tables to clear. This action cannot be undone.</p>
        </div>

        <div class="cache-tables-group">
          <label class="cache-table-item">
            <input type="checkbox" class="cache-table-checkbox" value="events" />
            <span>Events</span>
          </label>
          <label class="cache-table-item">
            <input type="checkbox" class="cache-table-checkbox" value="profiles" />
            <span>Profiles</span>
          </label>
          <label class="cache-table-item">
            <input type="checkbox" class="cache-table-checkbox" value="eventTags" />
            <span>Event Tags</span>
          </label>
          <label class="cache-table-item">
            <input type="checkbox" class="cache-table-checkbox" value="nip05" />
            <span>NIP-05</span>
          </label>
          <label class="cache-table-item">
            <input type="checkbox" class="cache-table-checkbox" value="lnurl" />
            <span>Lightning Addresses</span>
          </label>
          <label class="cache-table-item">
            <input type="checkbox" class="cache-table-checkbox" value="relayStatus" />
            <span>Relay Status</span>
          </label>
        </div>

        <div class="settings-section__actions">
          <button class="btn btn--medium btn--danger" id="clear-selected-btn">Clear Selected</button>
          <button class="btn btn--medium btn--danger" id="clear-all-btn">Clear All & Reload</button>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  private bindListeners(contentContainer: HTMLElement): void {
    // Save configuration button
    const saveBtn = contentContainer.querySelector('#save-cache-config-btn');
    saveBtn?.addEventListener('click', () => this.handleSaveConfig(contentContainer));

    // Clear selected tables button
    const clearSelectedBtn = contentContainer.querySelector('#clear-selected-btn');
    clearSelectedBtn?.addEventListener('click', () => this.handleClearSelected(contentContainer));

    // Clear all button
    const clearAllBtn = contentContainer.querySelector('#clear-all-btn');
    clearAllBtn?.addEventListener('click', () => this.handleClearAll());
  }

  /**
   * Handle save configuration
   */
  private handleSaveConfig(contentContainer: HTMLElement): void {
    // Notifications cache size
    const notificationsCacheSize = parseInt(
      (contentContainer.querySelector('#notifications-cache-size') as HTMLInputElement).value,
      10
    );

    if (isNaN(notificationsCacheSize) || notificationsCacheSize < 10 || notificationsCacheSize > 1000) {
      this.showMessage(contentContainer, 'Invalid notifications cache size (must be between 10-1000)', 'error');
      return;
    }

    // NDK cache sizes
    const profileCacheSize = parseInt(
      (contentContainer.querySelector('#profile-cache-size') as HTMLInputElement).value,
      10
    );
    const eventCacheSize = parseInt(
      (contentContainer.querySelector('#event-cache-size') as HTMLInputElement).value,
      10
    );
    const eventTagsCacheSize = parseInt(
      (contentContainer.querySelector('#event-tags-cache-size') as HTMLInputElement).value,
      10
    );
    const zapperCacheSize = parseInt(
      (contentContainer.querySelector('#zapper-cache-size') as HTMLInputElement).value,
      10
    );
    const nip05CacheSize = parseInt(
      (contentContainer.querySelector('#nip05-cache-size') as HTMLInputElement).value,
      10
    );
    const saveSig = (contentContainer.querySelector('#save-sig') as HTMLInputElement).checked;

    // Validation
    if (
      isNaN(profileCacheSize) || profileCacheSize < 1000 ||
      isNaN(eventCacheSize) || eventCacheSize < 1000 ||
      isNaN(eventTagsCacheSize) || eventTagsCacheSize < 1000 ||
      isNaN(zapperCacheSize) || zapperCacheSize < 50 ||
      isNaN(nip05CacheSize) || nip05CacheSize < 100
    ) {
      this.showMessage(contentContainer, 'Invalid cache size values', 'error');
      return;
    }

    // Save notifications cache size
    const notificationsCacheService = NotificationsCacheService.getInstance();
    notificationsCacheService.setLimit(notificationsCacheSize);

    // Save NDK cache config
    const config: NDKCacheConfig = {
      profileCacheSize,
      eventCacheSize,
      eventTagsCacheSize,
      zapperCacheSize,
      nip05CacheSize,
      saveSig
    };

    this.saveConfig(config);
    this.showMessage(
      contentContainer,
      'Configuration saved! Reload the app for NDK cache changes to take effect.',
      'success'
    );
  }

  /**
   * Handle clear selected tables
   */
  private async handleClearSelected(contentContainer: HTMLElement): Promise<void> {
    const checkboxes = contentContainer.querySelectorAll(
      '.cache-table-checkbox:checked'
    ) as NodeListOf<HTMLInputElement>;

    if (checkboxes.length === 0) {
      this.toastService.show('Please select at least one table to clear', 'warning');
      return;
    }

    const tableNames = Array.from(checkboxes).map(cb => cb.value);

    // Show confirmation modal
    this.modalService.show({
      title: 'Clear Selected Cache Tables?',
      content: `
        <div style="padding: 1rem 0;">
          <p style="margin-bottom: 1rem;">This will clear ${tableNames.length} table(s): ${tableNames.join(', ')}.</p>
          <p style="color: rgba(255, 100, 100, 0.8);">This action cannot be undone.</p>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn btn--danger" data-action="confirm">Clear Tables</button>
        </div>
      `,
      width: '500px',
      closeOnBackdrop: true,
      closeOnEsc: true
    });

    // Setup modal button handlers
    setTimeout(() => {
      const cancelBtn = document.querySelector('[data-action="cancel"]');
      const confirmBtn = document.querySelector('[data-action="confirm"]');

      cancelBtn?.addEventListener('click', () => {
        this.modalService.hide();
      });

      confirmBtn?.addEventListener('click', async () => {
        this.modalService.hide();

        try {
          // Import db from NDK cache adapter
          const { db } = await import('@nostr-dev-kit/ndk-cache-dexie');

          // Clear selected tables
          for (const tableName of tableNames) {
            if ((db as any)[tableName]) {
              await (db as any)[tableName].clear();
            }
          }

          // Uncheck all checkboxes
          checkboxes.forEach(cb => cb.checked = false);

          this.toastService.show(`Successfully cleared ${tableNames.length} cache table(s)`, 'success');
        } catch (error) {
          this.errorService.handleError(error, 'Failed to clear cache tables');
        }
      });
    }, 100);
  }

  /**
   * Handle clear all cache (delete entire database)
   */
  private async handleClearAll(): Promise<void> {
    // Show confirmation modal
    this.modalService.show({
      title: 'Clear All Cache & Reload?',
      content: `
        <div style="padding: 1rem 0;">
          <p style="margin-bottom: 1rem;">This will clear all safe cache tables and reload the app.</p>
          <p style="font-size: 13px; color: rgba(255, 255, 255, 0.6); margin-bottom: 1rem;">
            Excludes: Unpublished events and decrypted messages (protected from accidental deletion).
          </p>
          <p style="color: rgba(255, 100, 100, 0.8);">This action cannot be undone.</p>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn btn--danger" data-action="confirm">Clear Cache & Reload</button>
        </div>
      `,
      width: '500px',
      closeOnBackdrop: true,
      closeOnEsc: true
    });

    // Setup modal button handlers
    setTimeout(() => {
      const cancelBtn = document.querySelector('[data-action="cancel"]');
      const confirmBtn = document.querySelector('[data-action="confirm"]');

      cancelBtn?.addEventListener('click', () => {
        this.modalService.hide();
      });

      confirmBtn?.addEventListener('click', async () => {
        this.modalService.hide();

        try {
          // Import db from NDK cache adapter
          const { db } = await import('@nostr-dev-kit/ndk-cache-dexie');

          // Clear all safe tables (exclude unpublishedEvents, decryptedEvents, eventRelays)
          await Promise.all([
            db.events.clear(),
            db.profiles.clear(),
            db.eventTags.clear(),
            db.nip05.clear(),
            db.lnurl.clear(),
            db.relayStatus.clear()
          ]);

          this.toastService.show('Cache cleared successfully. Reloading...', 'success');

          // Reload after short delay
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } catch (error) {
          this.errorService.handleError(error, 'Failed to clear cache');
        }
      });
    }, 100);
  }

  /**
   * Show message
   */
  private showMessage(
    contentContainer: HTMLElement,
    message: string,
    type: 'success' | 'error'
  ): void {
    const messageEl = contentContainer.querySelector('#cache-config-message');
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.className = `settings-section__action-feedback settings-section__action-feedback--${type}`;

    setTimeout(() => {
      messageEl.textContent = '';
      messageEl.className = 'settings-section__action-feedback';
    }, 5000);
  }

  /**
   * Unmount section and cleanup
   */
  public unmount(): void {
    // Cleanup if needed
  }
}
