/**
 * PrivacySettingsSection Component
 * Manages NIP-51 privacy settings (Follow Lists, Bookmarks, Mutes)
 *
 * @purpose Configure private lists using NIP-51 encryption
 * @used-by SettingsView
 */

import { SettingsSection } from './SettingsSection';
import { FollowListOrchestrator } from '../../services/orchestration/FollowListOrchestrator';
import { BookmarkOrchestrator } from '../../services/orchestration/BookmarkOrchestrator';
import { MuteOrchestrator } from '../../services/orchestration/MuteOrchestrator';
import { AuthService } from '../../services/AuthService';
import { ModalService } from '../../services/ModalService';
import { ToastService } from '../../services/ToastService';
import { Switch } from '../ui/Switch';
import { EventBus } from '../../services/EventBus';

export class PrivacySettingsSection extends SettingsSection {
  private followListOrch: FollowListOrchestrator;
  private bookmarkOrch: BookmarkOrchestrator;
  private muteOrch: MuteOrchestrator;
  private authService: AuthService;
  private modalService: ModalService;
  private privateFollowsSwitch: Switch | null = null;
  private privateBookmarksSwitch: Switch | null = null;
  private privateMutesSwitch: Switch | null = null;

  constructor() {
    super('privacy-settings'); // Combined section ID
    this.followListOrch = FollowListOrchestrator.getInstance();
    this.bookmarkOrch = BookmarkOrchestrator.getInstance();
    this.muteOrch = MuteOrchestrator.getInstance();
    this.authService = AuthService.getInstance();
    this.modalService = ModalService.getInstance();
  }

  /**
   * Mount section content into the DOM
   */
  public mount(parentContainer: HTMLElement): void {
    const contentContainer = this.getContentContainer(parentContainer);
    if (!contentContainer) return;

    contentContainer.innerHTML = this.renderContent();
    this.bindListeners(contentContainer);
  }

  /**
   * Render privacy settings content
   */
  private renderContent(): string {
    return `
      <div class="privacy-settings">
        ${this.renderFollowLists()}
        ${this.renderBookmarks()}
        ${this.renderMutes()}
      </div>
    `;
  }

  /**
   * Render follow lists subsection
   */
  private renderFollowLists(): string {
    const isEnabled = this.followListOrch.isPrivateFollowsEnabled();

    return `
      <div class="privacy-subsection">
        <h3 class="subsection-title">Follow Lists</h3>
        <div class="follow-lists-settings">
          <div class="follow-lists-info">
            <p>Private follow lists (NIP-51) allow you to follow users without publicly revealing who you follow. Your follow list is encrypted and only you can see it.</p>
            <p class="follow-lists-warning">⚠️ <strong>Beta Feature:</strong> Not all Nostr clients support NIP-51 yet. If you use other clients that don't support NIP-51, you won't be able to see notes from your private follows.</p>
          </div>

          <div class="private-follows-switch-container" id="private-follows-switch-container">
            <!-- Switch will be mounted here -->
          </div>

          <div class="follow-lists-migration ${isEnabled ? '' : 'hidden'}" id="migration-section">
            <h4 class="migration-title">Migration Tools</h4>
            <p class="migration-description">Move your follows between public (kind:3 tags) and private (encrypted content) lists.</p>

            <div class="migration-buttons">
              <button class="btn btn--medium" id="migrate-to-private-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                All Public Follows → Private
              </button>

              <button class="btn btn--medium" id="migrate-to-public-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                </svg>
                All Private Follows → Public
              </button>
            </div>
          </div>

          <div class="follow-lists-links">
            <a href="#follows">View Follows</a>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render bookmarks subsection
   */
  private renderBookmarks(): string {
    return `
      <div class="privacy-subsection">
        <h3 class="subsection-title">Bookmarks</h3>
        <div class="bookmarks-settings">
          <div class="bookmarks-info">
            <p>Private bookmarks (NIP-51) allow you to bookmark notes without publicly revealing what you bookmarked. Your bookmarks are encrypted and only you can see them.</p>
            <p class="bookmarks-warning">⚠️ <strong>Beta Feature:</strong> Not all Nostr clients support NIP-51 yet. If you use other clients that don't support NIP-51, you won't be able to see your private bookmarks.</p>
          </div>

          <div class="private-bookmarks-switch-container" id="private-bookmarks-switch-container">
            <!-- Switch will be mounted here -->
          </div>

          <div class="bookmarks-links">
            <a href="#bookmarks">View Bookmarks</a>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render mutes subsection
   */
  private renderMutes(): string {
    const isPrivateMutesEnabled = this.muteOrch.isPrivateMutesEnabled();
    const encryptionMethod = this.muteOrch.getEncryptionMethod();

    return `
      <div class="privacy-subsection">
        <h3 class="subsection-title">Mutes</h3>
        <div class="mutes-settings">
          <div class="mutes-info">
            <p>Private mutes (NIP-51) allow you to mute users without publicly revealing who you muted. Your mute list is encrypted and only you can see it.</p>
            <p class="mutes-warning">⚠️ <strong>Beta Feature:</strong> Not all Nostr clients support NIP-51 yet. If you use other clients that don't support NIP-51, you won't be able to see your private mutes.</p>
          </div>

          <div class="private-mutes-switch-container" id="private-mutes-switch-container">
            <!-- Switch will be mounted here -->
          </div>

          <div class="mutes-encryption-method ${isPrivateMutesEnabled ? '' : 'hidden'}" id="mutes-encryption-method">
            <h4 class="encryption-method-title" style="font-size: 0.9rem; margin: 1rem 0 0.5rem 0; color: var(--text-secondary);">Encryption Method</h4>
            <div class="encryption-method-options" style="display: flex; flex-direction: column; gap: 0.75rem; margin-left: 0.5rem;">
              <label class="encryption-method-option" style="display: flex; align-items: start; gap: 0.5rem; cursor: pointer;">
                <input
                  type="radio"
                  name="mute-encryption-method"
                  value="nip04"
                  ${encryptionMethod === 'nip04' ? 'checked' : ''}
                  style="margin-top: 0.2rem;"
                />
                <div style="flex: 1;">
                  <div style="font-weight: 500;">NIP-04 (Compatible)</div>
                  <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
                    Works with all clients (Jumble, Mutable.top). Uses AES-256-CBC encryption.
                  </div>
                </div>
              </label>

              <label class="encryption-method-option" style="display: flex; align-items: start; gap: 0.5rem; cursor: pointer;">
                <input
                  type="radio"
                  name="mute-encryption-method"
                  value="nip44"
                  ${encryptionMethod === 'nip44' ? 'checked' : ''}
                  style="margin-top: 0.2rem;"
                />
                <div style="flex: 1;">
                  <div style="font-weight: 500;">NIP-44 (More Secure)</div>
                  <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
                    Modern standard with better security. May not work with older clients.
                  </div>
                </div>
              </label>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0.75rem 0 0 0.5rem; font-style: italic;">
              💡 Choose NIP-04 if you want to view your mutes in Jumble or other clients.
            </p>
          </div>

          <div class="mutes-links">
            <a href="#mutes">View Muted Users</a>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  private bindListeners(contentContainer: HTMLElement): void {
    this.bindFollowListsListeners(contentContainer);
    this.bindBookmarksListeners(contentContainer);
    this.bindMutesListeners(contentContainer);
  }

  /**
   * Bind follow lists event listeners
   */
  private bindFollowListsListeners(contentContainer: HTMLElement): void {
    const switchContainer = contentContainer.querySelector('#private-follows-switch-container');
    if (!switchContainer) return;

    const isEnabled = this.followListOrch.isPrivateFollowsEnabled();

    this.privateFollowsSwitch = new Switch({
      label: 'Use private follow lists (NIP-51)',
      checked: isEnabled,
      onChange: (checked) => {
        this.followListOrch.setPrivateFollowsEnabled(checked);

        const migrationSection = contentContainer.querySelector('#migration-section');
        if (migrationSection) {
          if (checked) {
            migrationSection.classList.remove('hidden');
          } else {
            migrationSection.classList.add('hidden');
          }
        }

        ToastService.show(
          checked ? 'Private follows enabled' : 'Private follows disabled',
          'success'
        );
      }
    });

    switchContainer.innerHTML = this.privateFollowsSwitch.render();
    this.privateFollowsSwitch.setupEventListeners(switchContainer as HTMLElement);

    const migrateToPrivateBtn = contentContainer.querySelector('#migrate-to-private-btn');
    const migrateToPublicBtn = contentContainer.querySelector('#migrate-to-public-btn');

    migrateToPrivateBtn?.addEventListener('click', () => this.handleMigrateToPrivate());
    migrateToPublicBtn?.addEventListener('click', () => this.handleMigrateToPublic());

    // Bind link to open Follows list in MainLayout
    const followListLink = contentContainer.querySelector('.follow-lists-links a');
    followListLink?.addEventListener('click', (e) => {
      e.preventDefault();
      EventBus.getInstance().emit('list:open', { listType: 'follows' });
    });
  }

  /**
   * Bind bookmarks event listeners
   */
  private bindBookmarksListeners(contentContainer: HTMLElement): void {
    const switchContainer = contentContainer.querySelector('#private-bookmarks-switch-container');
    if (!switchContainer) return;

    this.privateBookmarksSwitch = new Switch({
      label: 'Use private bookmarks (NIP-51)',
      checked: this.bookmarkOrch.isPrivateBookmarksEnabled(),
      onChange: async (checked) => {
        this.bookmarkOrch.setPrivateBookmarksEnabled(checked);

        ToastService.show(
          checked ? 'Private bookmarks enabled' : 'Private bookmarks disabled',
          'success'
        );
      }
    });

    switchContainer.innerHTML = this.privateBookmarksSwitch.render();
    this.privateBookmarksSwitch.setupEventListeners(switchContainer as HTMLElement);

    // Bind link to open Bookmarks list in MainLayout
    const bookmarkListLink = contentContainer.querySelector('.bookmarks-links a');
    bookmarkListLink?.addEventListener('click', (e) => {
      e.preventDefault();
      EventBus.getInstance().emit('list:open', { listType: 'bookmarks' });
    });
  }

  /**
   * Bind mutes event listeners
   */
  private bindMutesListeners(contentContainer: HTMLElement): void {
    const switchContainer = contentContainer.querySelector('#private-mutes-switch-container');
    if (!switchContainer) return;

    this.privateMutesSwitch = new Switch({
      label: 'Use private mutes (NIP-51)',
      checked: this.muteOrch.isPrivateMutesEnabled(),
      onChange: async (checked) => {
        this.muteOrch.setPrivateMutesEnabled(checked);

        // Show/hide encryption method selector
        const encryptionMethodSection = contentContainer.querySelector('#mutes-encryption-method');
        if (encryptionMethodSection) {
          if (checked) {
            encryptionMethodSection.classList.remove('hidden');
          } else {
            encryptionMethodSection.classList.add('hidden');
          }
        }

        ToastService.show(
          checked ? 'Private mutes enabled' : 'Private mutes disabled',
          'success'
        );
      }
    });

    switchContainer.innerHTML = this.privateMutesSwitch.render();
    this.privateMutesSwitch.setupEventListeners(switchContainer as HTMLElement);

    // Bind encryption method radio buttons
    const encryptionRadios = contentContainer.querySelectorAll('input[name="mute-encryption-method"]');
    encryptionRadios.forEach(radio => {
      radio.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement;
        const method = target.value as 'nip04' | 'nip44';

        this.muteOrch.setEncryptionMethod(method);

        ToastService.show(
          `Encryption method set to ${method.toUpperCase()}`,
          'success'
        );
      });
    });

    // Bind link to open Mutes list in MainLayout
    const muteListLink = contentContainer.querySelector('.mutes-links a');
    muteListLink?.addEventListener('click', (e) => {
      e.preventDefault();
      EventBus.getInstance().emit('list:open', { listType: 'mutes' });
    });
  }

  /**
   * Handle migrate to private (kind:3 → kind:30000)
   */
  private async handleMigrateToPrivate(): Promise<void> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      ToastService.show('Please log in to migrate follow lists', 'error');
      return;
    }

    this.modalService.show({
      title: 'Move Follows to Private List',
      content: `
        <div style="padding: 1rem 0;">
          <p>This will:</p>
          <ul style="margin: 1rem 0; padding-left: 1.5rem;">
            <li>Encrypt all your current public follows (kind:3)</li>
            <li>Store them in a private follow list (kind:30000)</li>
            <li>Clear your public follow list</li>
          </ul>
          <p><strong>Warning:</strong> This operation is irreversible without using the reverse migration tool.</p>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn" data-action="confirm">Migrate</button>
        </div>
      `,
      width: '500px',
      showCloseButton: true,
      closeOnOverlay: true,
      closeOnEsc: true
    });

    setTimeout(() => {
      const cancelBtn = document.querySelector('[data-action="cancel"]');
      const confirmBtn = document.querySelector('[data-action="confirm"]');

      cancelBtn?.addEventListener('click', () => {
        this.modalService.hide();
      });

      confirmBtn?.addEventListener('click', async () => {
        this.modalService.hide();

        try {
          const success = await this.followListOrch.migrateToPrivate(
            currentUser.pubkey
          );

          if (success) {
            ToastService.show('Follows migrated to private list', 'success');
          } else {
            ToastService.show('Migration failed', 'error');
          }
        } catch (error) {
          ToastService.show('Migration error: ' + error, 'error');
        }
      });
    }, 0);
  }

  /**
   * Handle migrate to public (kind:30000 → kind:3)
   */
  private async handleMigrateToPublic(): Promise<void> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      ToastService.show('Please log in to migrate follow lists', 'error');
      return;
    }

    this.modalService.show({
      title: 'Move Follows to Public List',
      content: `
        <div style="padding: 1rem 0;">
          <p>This will:</p>
          <ul style="margin: 1rem 0; padding-left: 1.5rem;">
            <li>Decrypt all your current private follows (kind:30000)</li>
            <li>Store them in a public follow list (kind:3)</li>
            <li>Clear your private follow list</li>
          </ul>
          <p><strong>Warning:</strong> Everyone will be able to see who you follow after this operation.</p>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn" data-action="confirm">Migrate</button>
        </div>
      `,
      width: '500px',
      showCloseButton: true,
      closeOnOverlay: true,
      closeOnEsc: true
    });

    setTimeout(() => {
      const cancelBtn = document.querySelector('[data-action="cancel"]');
      const confirmBtn = document.querySelector('[data-action="confirm"]');

      cancelBtn?.addEventListener('click', () => {
        this.modalService.hide();
      });

      confirmBtn?.addEventListener('click', async () => {
        this.modalService.hide();

        try {
          const success = await this.followListOrch.migrateToPublic(
            currentUser.pubkey
          );

          if (success) {
            ToastService.show('Follows migrated to public list', 'success');
          } else {
            ToastService.show('Migration failed', 'error');
          }
        } catch (error) {
          ToastService.show('Migration error: ' + error, 'error');
        }
      });
    }, 0);
  }

  /**
   * Unmount section and cleanup
   */
  public unmount(): void {
    if (this.privateFollowsSwitch) {
      this.privateFollowsSwitch = null;
    }
    if (this.privateBookmarksSwitch) {
      this.privateBookmarksSwitch = null;
    }
    if (this.privateMutesSwitch) {
      this.privateMutesSwitch = null;
    }
  }
}
