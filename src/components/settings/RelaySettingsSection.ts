/**
 * RelaySettingsSection Component
 * Manages public and local relay configuration
 *
 * @purpose Configure Nostr relay connections (public + local relay gateway)
 * @used-by SettingsView
 */

import { SettingsSection } from './SettingsSection';
import { RelayConfig, type RelayInfo, type RelayType } from '../../services/RelayConfig';
import { RelayListOrchestrator } from '../../services/orchestration/RelayListOrchestrator';
import { AuthService } from '../../services/AuthService';
import { ModalService } from '../../services/ModalService';
import { ToastService } from '../../services/ToastService';
import { Switch } from '../ui/Switch';
import { RelayHealthMonitor } from '../../services/RelayHealthMonitor';
import { EventBus } from '../../services/EventBus';
import { SystemLogger } from '../system/SystemLogger';

interface LocalRelaySettings {
  enabled: boolean;
  mode: 'test' | 'proxy';
  url: string;
}

export class RelaySettingsSection extends SettingsSection {
  private relayConfig: RelayConfig;
  private relayListOrchestrator: RelayListOrchestrator;
  private authService: AuthService;
  private modalService: ModalService;
  private healthMonitor: RelayHealthMonitor;
  private eventBus: EventBus;
  private localRelaySwitch: Switch | null = null;
  private localRelaySettings: LocalRelaySettings;
  private tempRelays: RelayInfo[];  // Temporary state for unsaved changes (public relays)
  private readonly storageKey = 'noornote_local_relay';
  private readonly publicRelaysStorageKey = 'noornote_public_relays';

  constructor() {
    super('relay-settings');
    this.relayConfig = RelayConfig.getInstance();
    this.relayListOrchestrator = RelayListOrchestrator.getInstance();
    this.authService = AuthService.getInstance();
    this.modalService = ModalService.getInstance();
    this.healthMonitor = RelayHealthMonitor.getInstance();
    this.eventBus = EventBus.getInstance();

    // Load settings
    this.localRelaySettings = this.loadLocalRelaySettings();
    this.tempRelays = this.loadPublicRelays();

    // Setup health update listener
    this.setupHealthUpdateListener();
  }

  /**
   * Setup listener for relay health updates
   */
  private setupHealthUpdateListener(): void {
    this.eventBus.on('relay:health:updated', () => {
      this.updateHealthIndicators();
    });
  }

  /**
   * Update health indicators in the UI (called when health metrics change)
   */
  private updateHealthIndicators(): void {
    const relayItems = document.querySelectorAll('.relay-item');
    relayItems.forEach((item) => {
      const url = (item as HTMLElement).dataset.url;
      if (!url) return;

      const metrics = this.healthMonitor.getMetrics(url);
      const indicator = item.querySelector('.relay-health-indicator');

      if (indicator && metrics) {
        indicator.className = `relay-health-indicator ${metrics.isConnected ? 'connected' : 'disconnected'}`;
      }
    });

    // Update health summary
    this.updateHealthSummary();
  }

  /**
   * Update health summary section
   */
  private async updateHealthSummary(): Promise<void> {
    const summaryContainer = document.querySelector('#relay-health-summary');
    if (!summaryContainer) return;

    const summary = await this.healthMonitor.getHealthSummary();
    summaryContainer.innerHTML = this.renderHealthSummary(summary);
  }

  /**
   * Load local relay settings from storage
   */
  private loadLocalRelaySettings(): LocalRelaySettings {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load local relay settings:', error);
    }

    // Default: Local relay disabled
    return {
      enabled: false,
      mode: 'test',
      url: 'ws://localhost:4869'
    };
  }

  /**
   * Save local relay settings to storage
   */
  private saveLocalRelaySettings(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.localRelaySettings));
    } catch (error) {
      console.warn('Failed to save local relay settings:', error);
    }
  }

  /**
   * Load public relays from storage
   * These are the relays configured by the user, separate from what's actually active
   * Priority: localStorage > RelayConfig (from NIP-65) > defaults
   */
  private loadPublicRelays(): RelayInfo[] {
    try {
      const stored = localStorage.getItem(this.publicRelaysStorageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load public relays:', error);
    }

    // If no stored public relays, use current RelayConfig (excluding localhost)
    // This will include NIP-65 relays if user logged in
    return this.relayConfig.getAllRelays().filter(r => !r.url.includes('localhost'));
  }

  /**
   * Save public relays to storage
   */
  private savePublicRelays(relays: RelayInfo[]): void {
    try {
      localStorage.setItem(this.publicRelaysStorageKey, JSON.stringify(relays));
    } catch (error) {
      console.warn('Failed to save public relays:', error);
    }
  }

  /**
   * Mount section content into the DOM
   */
  public async mount(parentContainer: HTMLElement): Promise<void> {
    const contentContainer = this.getContentContainer(parentContainer);
    if (!contentContainer) return;

    // Reload temp state to ensure we have latest relays
    this.tempRelays = this.loadPublicRelays();

    contentContainer.innerHTML = this.renderContent();
    this.bindListeners(contentContainer);

    // Load health summary async
    await this.updateHealthSummary();
  }

  /**
   * Render relay settings content
   */
  private renderContent(): string {
    // Health summary will be updated async after mount
    return `
      <div class="relay-settings">
        <!-- Health Summary -->
        <div class="relay-health-summary" id="relay-health-summary">
          <div class="health-summary-loading">Loading relay health status...</div>
        </div>

        <!-- Add new relay -->
        <div class="relay-add-form">
          <input
            type="text"
            class="relay-input"
            placeholder="wss://relay.example.com"
            id="new-relay-url"
          />
          <button class="btn btn--medium" id="add-relay-btn">Add Relay</button>
        </div>

        <!-- Relay list -->
        <div class="relay-list">
          ${this.tempRelays.map(relay => this.renderRelayItem(relay)).join('')}
        </div>

        <!-- Local backup relay -->
        <div class="local-relay-section">
          <h3 class="local-relay-title">Local Relay (Optional)</h3>
          <p class="local-relay-description">
            When enabled, Noornote connects ONLY to your local relay at <code>${this.localRelaySettings.url}</code>.
            The local relay itself syncs with the public relays above (for reads always, for writes only in PROXY mode).
            See <code>relay/README.md</code> for setup.
          </p>

          <div class="local-relay-controls">
            <div class="local-relay-enable" id="local-relay-switch-container">
              <!-- Switch will be mounted here -->
            </div>

            <div class="local-relay-mode">
              <label>Local Relay Mode:</label>
              <div class="mode-switch">
                <button
                  class="mode-btn ${this.localRelaySettings.mode === 'test' ? 'active' : ''}"
                  data-mode="test"
                >
                  TEST (writes local only)
                </button>
                <button
                  class="mode-btn ${this.localRelaySettings.mode === 'proxy' ? 'active' : ''}"
                  data-mode="proxy"
                >
                  PROXY (writes forwarded)
                </button>
              </div>
            </div>

            <div class="local-relay-command">
              <label>Start local relay with:</label>
              <code class="restart-command">
                1. colima start<br>
                2. cd relay && ./scripts/${this.localRelaySettings.mode}-mode.sh
              </code>
            </div>
          </div>
        </div>

        <!-- Save button -->
        <div class="relay-save-section">
          <button class="btn btn--medium" id="save-relay-settings-btn">Save Settings</button>
          <div class="save-message" id="save-message"></div>
        </div>
      </div>
    `;
  }

  /**
   * Render health summary section
   */
  private renderHealthSummary(summary: { healthy: number; total: number; warnings: string[] }): string {
    if (summary.total === 0) {
      return '<div class="health-summary-empty">No relays configured</div>';
    }

    const healthPercentage = summary.total > 0 ? Math.round((summary.healthy / summary.total) * 100) : 0;
    const healthClass = healthPercentage >= 80 ? 'good' : healthPercentage >= 50 ? 'warning' : 'critical';

    return `
      <div class="health-summary-status">
        <span class="health-summary-badge health-summary-badge--${healthClass}">
          ${summary.healthy}/${summary.total} relays healthy (${healthPercentage}%)
        </span>
      </div>
      ${summary.warnings.length > 0 ? `
        <div class="health-summary-warnings">
          ${summary.warnings.map(warning => `
            <div class="health-warning">⚠️ ${warning}</div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  /**
   * Render single relay item
   */
  private renderRelayItem(relay: RelayInfo): string {
    const metrics = this.healthMonitor.getMetrics(relay.url);
    const isConnected = metrics?.isConnected ?? false;
    const latency = metrics?.latency;

    return `
      <div class="relay-item" data-url="${relay.url}">
        <div class="relay-info">
          <span class="relay-health-indicator ${isConnected ? 'connected' : 'disconnected'}"></span>
          <div class="relay-url">
            ${relay.url}
            ${latency !== null && latency !== undefined ? `<span class="relay-latency">${latency}ms</span>` : ''}
          </div>
        </div>

        <div class="relay-controls">
          <div class="relay-types">
            <button
              class="relay-type-btn ${relay.types.includes('read') ? 'active' : ''}"
              data-type="read"
              data-url="${relay.url}"
            >
              Read
            </button>
            <button
              class="relay-type-btn ${relay.types.includes('write') ? 'active' : ''}"
              data-type="write"
              data-url="${relay.url}"
            >
              Write
            </button>
            <button
              class="relay-type-btn ${relay.types.includes('inbox') ? 'active' : ''}"
              data-type="inbox"
              data-url="${relay.url}"
            >
              DM Inbox
            </button>
          </div>

          <button class="relay-remove-btn" data-url="${relay.url}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  private bindListeners(contentContainer: HTMLElement): void {
    // Add relay button
    const addBtn = contentContainer.querySelector('#add-relay-btn');
    addBtn?.addEventListener('click', () => this.handleAddRelay(contentContainer));

    // Add relay on Enter key
    const input = contentContainer.querySelector('#new-relay-url') as HTMLInputElement;
    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAddRelay(contentContainer);
    });

    // Relay type toggle buttons
    const typeButtons = contentContainer.querySelectorAll('.relay-type-btn');
    typeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleToggleRelayType(e));
    });

    // Remove relay buttons
    const removeButtons = contentContainer.querySelectorAll('.relay-remove-btn');
    removeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleRemoveRelay(e, contentContainer));
    });

    // Local relay mode buttons
    const modeButtons = contentContainer.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleLocalRelayModeChange(e, contentContainer));
    });

    // Local relay enable switch
    const switchContainer = contentContainer.querySelector('#local-relay-switch-container');
    if (switchContainer) {
      this.localRelaySwitch = new Switch({
        label: `Use local relay as gateway (${this.localRelaySettings.url})`,
        checked: this.localRelaySettings.enabled,
        onChange: (checked) => {
          this.localRelaySettings.enabled = checked;
          this.saveLocalRelaySettings();
        }
      });

      switchContainer.innerHTML = this.localRelaySwitch.render();
      this.localRelaySwitch.setupEventListeners(switchContainer as HTMLElement);
    }

    // Save button
    const saveBtn = contentContainer.querySelector('#save-relay-settings-btn');
    saveBtn?.addEventListener('click', () => this.handleSave(contentContainer));
  }

  /**
   * Handle add new relay
   */
  private handleAddRelay(contentContainer: HTMLElement): void {
    const input = contentContainer.querySelector('#new-relay-url') as HTMLInputElement;
    let url = input?.value.trim();

    if (!url) return;

    // Validate URL
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      ToastService.show('Relay URL must start with wss:// or ws://', 'error');
      return;
    }

    // Normalize URL: remove trailing slash
    url = url.replace(/\/$/, '');

    // Check for duplicates (compare normalized URLs)
    const normalizedExisting = this.tempRelays.map(r => r.url.replace(/\/$/, ''));
    if (normalizedExisting.includes(url)) {
      ToastService.show('This relay is already in your list', 'error');
      return;
    }

    // Add relay to temporary state
    this.tempRelays.push({
      url,
      types: ['read', 'write'],
      isPaid: false,
      requiresAuth: false,
      isActive: true
    });

    // Clear input and re-render
    input.value = '';
    contentContainer.innerHTML = this.renderContent();
    this.bindListeners(contentContainer);
  }

  /**
   * Handle toggle relay type (Read/Write/DM Inbox)
   */
  private handleToggleRelayType(e: Event): void {
    const btn = e.currentTarget as HTMLElement;
    const url = btn.dataset.url;
    const type = btn.dataset.type as RelayType;

    if (!url || !type) return;

    const relay = this.tempRelays.find(r => r.url === url);

    if (!relay) return;

    // Toggle type
    if (relay.types.includes(type)) {
      relay.types = relay.types.filter(t => t !== type);
      btn.classList.remove('active');
    } else {
      relay.types.push(type);
      btn.classList.add('active');
    }

    // Don't re-render to avoid re-binding event listeners multiple times
  }

  /**
   * Handle remove relay
   */
  private handleRemoveRelay(e: Event, contentContainer: HTMLElement): void {
    const btn = e.currentTarget as HTMLElement;
    const url = btn.dataset.url;

    if (!url) return;

    // Show confirmation modal
    this.modalService.show({
      title: 'Remove Relay',
      content: `
        <div style="padding: 1rem 0;">
          <p>Are you sure you want to remove this relay?</p>
          <p style="margin-top: 0.5rem; color: var(--color-text-secondary); font-size: 0.9rem;">
            <strong>${url}</strong>
          </p>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn btn--danger" data-action="confirm">Remove</button>
        </div>
      `,
      width: '500px',
      showCloseButton: true,
      closeOnOverlay: true,
      closeOnEsc: true
    });

    // Setup modal button handlers
    setTimeout(() => {
      const cancelBtn = document.querySelector('[data-action="cancel"]');
      const confirmBtn = document.querySelector('[data-action="confirm"]');

      cancelBtn?.addEventListener('click', () => {
        this.modalService.hide();
      });

      confirmBtn?.addEventListener('click', () => {
        this.tempRelays = this.tempRelays.filter(r => r.url !== url);
        this.modalService.hide();
        contentContainer.innerHTML = this.renderContent();
        this.bindListeners(contentContainer);
      });
    }, 0);
  }

  /**
   * Handle local relay mode change (TEST ↔ PROXY)
   */
  private handleLocalRelayModeChange(e: Event, contentContainer: HTMLElement): void {
    const btn = e.currentTarget as HTMLElement;
    const mode = btn.dataset.mode as 'test' | 'proxy';

    if (!mode) return;

    this.localRelaySettings.mode = mode;

    // Save immediately to localStorage so it persists
    this.saveLocalRelaySettings();

    // Update command display
    const commandEl = contentContainer.querySelector('.restart-command');
    if (commandEl) {
      commandEl.innerHTML = `
        1. colima start<br>
        2. cd relay && ./scripts/${mode}-mode.sh
      `;
    }

    // Update active button
    const modeButtons = contentContainer.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => btn.classList.remove('active'));
    btn.classList.add('active');
  }

  /**
   * Handle save settings
   */
  private async handleSave(contentContainer: HTMLElement): Promise<void> {
    // Get current user
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      this.showMessage(contentContainer, 'Please log in to save relay settings', 'error');
      return;
    }

    try {
      // Save public relays to localStorage
      this.savePublicRelays(this.tempRelays);

      // Save local relay settings to localStorage
      this.saveLocalRelaySettings();

      // Clear all existing relays from RelayConfig
      const existingRelays = this.relayConfig.getAllRelays();
      existingRelays.forEach(relay => {
        this.relayConfig.removeRelay(relay.url);
      });

      // Determine what relays to activate in RelayConfig
      if (this.localRelaySettings.enabled) {
        // Local relay mode (TEST/PROXY):
        // - Read from public relays (Timeline fetches from there)
        // - Write ONLY to local relay (Posts go only to local)

        // Add public relays for READ only
        this.tempRelays.forEach(relay => {
          this.relayConfig.addRelay({
            ...relay,
            types: ['read'] // Only read from public relays
          });
        });

        // Add local relay for WRITE only
        this.relayConfig.addRelay({
          url: this.localRelaySettings.url,
          name: 'Local Relay',
          types: ['write', 'inbox'], // Only write to local relay
          isPaid: false,
          requiresAuth: false,
          isActive: true
        });
      } else {
        // Direct mode: Use public relays normally
        this.tempRelays.forEach(relay => {
          this.relayConfig.addRelay(relay);
        });
      }

      // Publish NIP-65 relay list (kind:10002) to network
      await this.publishRelayList();

      // Publish NIP-17 DM relay list (kind:10050) to network
      await this.publishDMRelayList();

      this.showMessage(contentContainer, 'Settings saved successfully!', 'success');
    } catch (error) {
      this.showMessage(contentContainer, 'Failed to save settings: ' + error, 'error');
    }
  }

  /**
   * Publish relay list to network as NIP-65 (kind:10002)
   */
  private async publishRelayList(): Promise<void> {
    try {
      const currentUser = this.authService.getCurrentUser();
      if (!currentUser) {
        console.warn('No user logged in, skipping relay list publish');
        return;
      }

      // Create unsigned kind:10002 event
      const relayTags = RelayListOrchestrator.relayInfosToTags(this.tempRelays);
      const unsignedEvent = {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000),
        tags: relayTags,
        content: '',
        pubkey: currentUser.pubkey
      };

      // Sign event with browser extension
      const signedEvent = await this.authService.signEvent(unsignedEvent);

      // Publish to current write relays
      const publishRelays = this.relayConfig.getWriteRelays();
      if (publishRelays.length === 0) {
        console.warn('No write relays available for publishing');
        return;
      }

      await this.relayListOrchestrator.publishRelayList(
        this.tempRelays,
        publishRelays,
        signedEvent
      );

      console.log('Relay list published successfully');
    } catch (error) {
      console.error('Failed to publish relay list:', error);
      throw error; // Re-throw to be caught by handleSave
    }
  }

  /**
   * Publish DM relay list to network as NIP-17 (kind:10050)
   * Only publishes if there are relays with 'inbox' type
   */
  private async publishDMRelayList(): Promise<void> {
    const systemLogger = SystemLogger.getInstance();

    try {
      const currentUser = this.authService.getCurrentUser();
      if (!currentUser) {
        systemLogger.warn('RelaySettings', 'No user logged in, skipping DM relay list publish');
        return;
      }

      // Get relays marked as inbox
      const inboxRelays = this.tempRelays.filter(r => r.types.includes('inbox'));

      if (inboxRelays.length === 0) {
        systemLogger.info('RelaySettings', 'No DM inbox relays configured, skipping kind:10050 publish');
        return;
      }

      // Create relay tags for kind:10050 - format: ["relay", "wss://relay.example.com"]
      const relayTags = inboxRelays.map(r => ['relay', r.url]);

      const unsignedEvent = {
        kind: 10050,
        created_at: Math.floor(Date.now() / 1000),
        tags: relayTags,
        content: '',
        pubkey: currentUser.pubkey
      };

      // Sign event
      const signedEvent = await this.authService.signEvent(unsignedEvent);

      // Publish to current write relays
      const publishRelays = this.relayConfig.getWriteRelays();
      if (publishRelays.length === 0) {
        systemLogger.warn('RelaySettings', 'No write relays available for publishing DM relay list');
        return;
      }

      // Import NostrTransport for publishing
      const { NostrTransport } = await import('../../services/transport/NostrTransport');
      const transport = NostrTransport.getInstance();
      await transport.publish(publishRelays, signedEvent);

      const relayUrls = inboxRelays.map(r => r.url).join(', ');
      systemLogger.info('RelaySettings', `Published kind:10050 DM relay list with ${inboxRelays.length} relays: ${relayUrls}`);
    } catch (error) {
      systemLogger.error('RelaySettings', 'Failed to publish DM relay list:', error);
      // Don't throw - DM relay list is optional, main relay list is more important
    }
  }

  /**
   * Show message
   */
  private showMessage(contentContainer: HTMLElement, message: string, type: 'success' | 'error'): void {
    const messageEl = contentContainer.querySelector('#save-message');
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.className = `save-message save-message--${type}`;

    setTimeout(() => {
      messageEl.textContent = '';
      messageEl.className = 'save-message';
    }, 5000);
  }

  /**
   * Unmount section and cleanup
   */
  public unmount(): void {
    // Cleanup if needed
    if (this.localRelaySwitch) {
      this.localRelaySwitch = null;
    }
  }
}
