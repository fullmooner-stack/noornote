/**
 * ProfileEditModal Component
 * Modal dialog for editing user profile metadata (Kind 0 events)
 *
 * Features:
 * - Avatar and banner image upload (uses ImageUploader)
 * - Text inputs for all profile fields
 * - Validation (NIP-05, Lightning address, URLs)
 * - Live preview of uploaded images
 * - Save button (publishes to relays via ProfileEditorService)
 */

import { ModalService } from '../../services/ModalService';
import { ProfileEditorService, type ProfileMetadata } from '../../services/ProfileEditorService';
import { UserProfileService, type UserProfile } from '../../services/UserProfileService';
import { AuthService } from '../../services/AuthService';
import { SystemLogger } from '../system/SystemLogger';
import { ImageUploader } from './ImageUploader';
import { EventBus } from '../../services/EventBus';

export class ProfileEditModal {
  private static instance: ProfileEditModal;
  private modalService: ModalService;
  private profileEditorService: ProfileEditorService;
  private userProfileService: UserProfileService;
  private authService: AuthService;
  private systemLogger: SystemLogger;
  private eventBus: EventBus;

  // Sub-components
  private avatarUploader: ImageUploader | null = null;
  private bannerUploader: ImageUploader | null = null;

  // State
  private originalProfile: UserProfile | null = null;
  private currentProfile: Partial<ProfileMetadata> = {};
  private hasChanges: boolean = false;
  private saving: boolean = false;

  private constructor() {
    this.modalService = ModalService.getInstance();
    this.profileEditorService = ProfileEditorService.getInstance();
    this.userProfileService = UserProfileService.getInstance();
    this.authService = AuthService.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.eventBus = EventBus.getInstance();
  }

  public static getInstance(): ProfileEditModal {
    if (!ProfileEditModal.instance) {
      ProfileEditModal.instance = new ProfileEditModal();
    }
    return ProfileEditModal.instance;
  }

  /**
   * Show the profile editor modal
   */
  public async show(): Promise<void> {
    // Get current user's profile
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      this.systemLogger.error('ProfileEditModal', 'Cannot open: User not authenticated');
      return;
    }

    // Fetch current profile data
    this.originalProfile = await this.userProfileService.getUserProfile(currentUser.pubkey);
    // For NIP-05: prefer nip05s from tags, fallback to single nip05
    const nip05s = this.originalProfile.nip05s && this.originalProfile.nip05s.length > 0
      ? this.originalProfile.nip05s
      : (this.originalProfile.nip05 ? [this.originalProfile.nip05] : []);

    this.currentProfile = {
      name: this.originalProfile.name || '',
      display_name: this.originalProfile.display_name || '',
      about: this.originalProfile.about || '',
      picture: this.originalProfile.picture || '',
      banner: this.originalProfile.banner || '',
      website: this.originalProfile.website || '',
      nip05: nip05s.join(', '), // Show as comma-separated for editing
      lud16: this.originalProfile.lud16 || '',
      lud06: this.originalProfile.lud06 || ''
    };

    this.hasChanges = false;
    this.saving = false;

    const modalContent = this.renderContent();

    this.modalService.show({
      title: 'Edit Profile',
      content: modalContent,
      width: '600px',
      showCloseButton: true,
      closeOnOverlay: false,
      closeOnEsc: true
    });

    setTimeout(() => {
      this.setupEventHandlers();
    }, 0);
  }

  /**
   * Render modal content
   */
  private renderContent(): string {
    return `
      <div class="profile-edit-modal">
        ${this.renderBannerUploader()}
        ${this.renderAvatarUploader()}
        ${this.renderForm()}
        ${this.renderActions()}
      </div>
    `;
  }

  /**
   * Render banner uploader
   */
  private renderBannerUploader(): string {
    this.bannerUploader = new ImageUploader({
      currentUrl: this.currentProfile.banner,
      onUploadSuccess: (url) => {
        this.currentProfile.banner = url;
        this.markAsChanged();
      },
      mediaType: 'banner',
      className: 'profile-banner-uploader'
    });

    return `
      <div class="profile-banner-section">
        ${this.bannerUploader.render()}
      </div>
    `;
  }

  /**
   * Render avatar uploader
   */
  private renderAvatarUploader(): string {
    this.avatarUploader = new ImageUploader({
      currentUrl: this.currentProfile.picture,
      onUploadSuccess: (url) => {
        this.currentProfile.picture = url;
        this.markAsChanged();
      },
      mediaType: 'avatar',
      className: 'profile-avatar-uploader'
    });

    return `
      <div class="profile-avatar-section">
        ${this.avatarUploader.render()}
      </div>
    `;
  }

  /**
   * Render form inputs
   */
  private renderForm(): string {
    return `
      <form class="profile-edit-form" data-form>
        <div class="form-group">
          <label for="display_name">Display Name</label>
          <input
            type="text"
            id="display_name"
            name="display_name"
            class="input"
            value="${this.escapeHtml(this.currentProfile.display_name || '')}"
            placeholder="Your full name"
            data-input="display_name"
          />
        </div>

        <div class="form-group">
          <label for="name">Username</label>
          <input
            type="text"
            id="name"
            name="name"
            class="input"
            value="${this.escapeHtml(this.currentProfile.name || '')}"
            placeholder="username"
            data-input="name"
          />
        </div>

        <div class="form-group">
          <label for="about">Bio</label>
          <textarea
            id="about"
            name="about"
            class="textarea textarea--small"
            rows="3"
            placeholder="Tell us about yourself..."
            data-input="about"
          >${this.escapeHtml(this.currentProfile.about || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="website">Website</label>
          <input
            type="text"
            id="website"
            name="website"
            class="input"
            value="${this.escapeHtml(this.currentProfile.website || '')}"
            placeholder="https://example.com"
            data-input="website"
          />
        </div>

        <div class="form-group">
          <label for="nip05">NIP-05 Identifier</label>
          <input
            type="text"
            id="nip05"
            name="nip05"
            class="input"
            value="${this.escapeHtml(this.currentProfile.nip05 || '')}"
            placeholder="user@domain.com"
            data-input="nip05"
          />
          <small class="form-hint">Verification identifier(s), comma-separated (user@domain.com, user@other.com)</small>
        </div>

        <div class="form-group">
          <label for="lud16">Lightning Address</label>
          <input
            type="text"
            id="lud16"
            name="lud16"
            class="input"
            value="${this.escapeHtml(this.currentProfile.lud16 || '')}"
            placeholder="user@getalby.com"
            data-input="lud16"
          />
          <small class="form-hint">Email format (user@domain.com) or LNURL</small>
        </div>
      </form>
    `;
  }

  /**
   * Render action buttons
   */
  private renderActions(): string {
    return `
      <div class="profile-edit-actions">
        <button class="btn btn--passive" data-action="cancel">Cancel</button>
        <button class="btn" data-action="save" disabled>
          <span data-save-text>Sync to Relays</span>
          <span data-save-spinner style="display: none;">Saving...</span>
        </button>
      </div>
    `;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    const modal = document.querySelector('.profile-edit-modal');
    if (!modal) return;

    // Setup image uploaders
    const bannerSection = modal.querySelector('.profile-banner-section');
    if (bannerSection && this.bannerUploader) {
      this.bannerUploader.setupEventListeners(bannerSection as HTMLElement);
    }

    const avatarSection = modal.querySelector('.profile-avatar-section');
    if (avatarSection && this.avatarUploader) {
      this.avatarUploader.setupEventListeners(avatarSection as HTMLElement);
    }

    // Setup form inputs
    const inputs = modal.querySelectorAll('[data-input]');
    inputs.forEach((input) => {
      input.addEventListener('input', (e) => {
        this.handleInputChange(e.target as HTMLInputElement | HTMLTextAreaElement);
      });
    });

    // Setup action buttons
    const cancelBtn = modal.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    const saveBtn = modal.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.handleSave();
      });
    }
  }

  /**
   * Handle input change
   */
  private handleInputChange(input: HTMLInputElement | HTMLTextAreaElement): void {
    const fieldName = input.getAttribute('data-input') as keyof ProfileMetadata;
    const value = input.value;

    this.currentProfile[fieldName] = value;
    this.markAsChanged();
  }

  /**
   * Mark profile as changed
   */
  private markAsChanged(): void {
    this.hasChanges = true;
    this.updateSaveButton();
  }

  /**
   * Update save button state
   */
  private updateSaveButton(): void {
    const saveBtn = document.querySelector('[data-action="save"]') as HTMLButtonElement;
    if (saveBtn) {
      saveBtn.disabled = !this.hasChanges || this.saving;
    }
  }

  /**
   * Handle cancel button
   */
  private handleCancel(): void {
    this.cleanup();
    this.modalService.hide();
  }

  /**
   * Handle save button
   */
  private async handleSave(): Promise<void> {
    if (!this.hasChanges || this.saving) return;

    this.saving = true;
    this.updateSaveButton();
    this.showSavingState();

    try {
      // Convert comma-separated NIP-05 string to array (Animestr-style)
      const profileToSave = { ...this.currentProfile };
      if (profileToSave.nip05) {
        const nip05s = profileToSave.nip05
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
        profileToSave.nip05s = nip05s;
        // Keep nip05 as primary for backwards compatibility (ProfileEditorService handles this)
        profileToSave.nip05 = nip05s[0] || '';
      }

      // Publish profile update
      const result = await this.profileEditorService.updateProfile(profileToSave);

      if (result) {
        // Success - emit profile update event
        this.eventBus.emit('profile:updated', {
          pubkey: this.authService.getCurrentUser()?.pubkey
        });

        // Close modal
        this.cleanup();
        this.modalService.hide();
      } else {
        // Error already handled by ProfileEditorService
        this.saving = false;
        this.hideSavingState();
        this.updateSaveButton();
      }
    } catch (error) {
      this.systemLogger.error('ProfileEditModal', 'Save error:', error);
      this.saving = false;
      this.hideSavingState();
      this.updateSaveButton();
    }
  }

  /**
   * Show saving state on button
   */
  private showSavingState(): void {
    const saveText = document.querySelector('[data-save-text]') as HTMLElement;
    const saveSpinner = document.querySelector('[data-save-spinner]') as HTMLElement;

    if (saveText) saveText.style.display = 'none';
    if (saveSpinner) saveSpinner.style.display = 'inline';
  }

  /**
   * Hide saving state on button
   */
  private hideSavingState(): void {
    const saveText = document.querySelector('[data-save-text]') as HTMLElement;
    const saveSpinner = document.querySelector('[data-save-spinner]') as HTMLElement;

    if (saveText) saveText.style.display = 'inline';
    if (saveSpinner) saveSpinner.style.display = 'none';
  }

  /**
   * Cleanup
   */
  private cleanup(): void {
    this.avatarUploader?.cleanup();
    this.bannerUploader?.cleanup();
    this.avatarUploader = null;
    this.bannerUploader = null;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
