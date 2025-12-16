/**
 * UserIdentity Component
 * Displays username + avatar for a pubkey
 *
 * Fetch strategy (in order):
 * 1. localStorage (usernameCache/pictureCache) - instant
 * 2. profileCache - fast
 * 3. Bootstrap relays (user's standard relays) - normal fetch
 * 4. FALLBACK: User's outbound relays (NIP-65) - slow, only if all else fails
 *
 * Usage:
 * const identity = new UserIdentity({ pubkey, size: 'small' });
 * container.appendChild(identity.getElement());
 */

import { UserProfileService } from '../../services/UserProfileService';
import { UserHoverCard } from '../ui/UserHoverCard';

export interface UserIdentityConfig {
  pubkey: string;
  size?: 'small' | 'medium' | 'large'; // Avatar size
  showAvatar?: boolean; // Default: true
  showUsername?: boolean; // Default: true
  enableHoverCard?: boolean; // Default: true - show user hover card on hover
}

export class UserIdentity {
  private element: HTMLElement;
  private config: UserIdentityConfig;
  private userProfileService: UserProfileService;
  private unsubscribe?: () => void;

  constructor(config: UserIdentityConfig) {
    this.config = {
      size: 'medium',
      showAvatar: true,
      showUsername: true,
      enableHoverCard: true,
      ...config
    };

    this.userProfileService = UserProfileService.getInstance();

    this.element = this.createElement();
    this.loadIdentity();

    // Setup hover card if enabled
    if (this.config.enableHoverCard) {
      this.setupHoverCard();
    }
  }

  /**
   * Create the identity element
   */
  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = `user-identity user-identity--${this.config.size}`;

    if (this.config.showAvatar) {
      const avatar = document.createElement('img');
      avatar.className = 'user-identity__avatar';
      avatar.alt = 'Avatar';
      avatar.loading = 'lazy';
      container.appendChild(avatar);
    }

    if (this.config.showUsername) {
      const username = document.createElement('span');
      username.className = 'user-identity__username';
      username.textContent = ''; // Empty initially
      container.appendChild(username);
    }

    return container;
  }

  /**
   * Load identity - ONLY render when profile is loaded (like Jumble)
   */
  private async loadIdentity(): Promise<void> {
    // Hide element until profile loads (no cache)
    this.element.style.display = 'none';

    // Subscribe to updates so UI shows when real profile loads
    this.subscribeToUpdates();
  }


  /**
   * Subscribe to profile updates
   */
  private subscribeToUpdates(): void {
    this.unsubscribe = this.userProfileService.subscribeToProfile(
      this.config.pubkey,
      (profile) => {
        // Extract data from profile object (no cache)
        const username = profile.display_name || profile.name || profile.username || 'Anon';
        const picture = profile.picture || '';

        // Show element and update UI
        this.element.style.display = '';
        this.updateUI(username, picture);
      }
    );
  }

  /**
   * Update UI with username and picture
   */
  private updateUI(username: string, picture: string): void {
    if (this.config.showUsername) {
      const usernameEl = this.element.querySelector('.user-identity__username');
      if (usernameEl) {
        usernameEl.textContent = username;
      }
    }

    if (this.config.showAvatar) {
      const avatarEl = this.element.querySelector('.user-identity__avatar') as HTMLImageElement;
      if (avatarEl) {
        avatarEl.src = picture;
      }
    }
  }

  /**
   * Get the DOM element
   */
  public getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Setup hover card for this user identity
   */
  private setupHoverCard(): void {
    const userHoverCard = UserHoverCard.getInstance();

    this.element.addEventListener('mouseenter', () => {
      userHoverCard.show(this.config.pubkey, this.element);
    });

    this.element.addEventListener('mouseleave', () => {
      userHoverCard.hide();
    });
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
