/**
 * DMBadgeManager
 * Manages DM badge in MainLayout sidebar
 *
 * @purpose Update badge count based on unread DMs
 * @used-by MainLayout
 */

import { EventBus } from '../../../services/EventBus';
import { DMService } from '../../../services/dm/DMService';
import { AuthService } from '../../../services/AuthService';

export class DMBadgeManager {
  private eventBus: EventBus;
  private dmService: DMService;
  private authService: AuthService;
  private badgeElement: HTMLElement | null = null;
  private badgeUpdateSubscriptionId: string | null = null;

  constructor(badgeElement: HTMLElement) {
    this.badgeElement = badgeElement;
    this.eventBus = EventBus.getInstance();
    this.dmService = DMService.getInstance();
    this.authService = AuthService.getInstance();

    this.setupEventListeners();
    this.updateBadgeCount();
  }

  /**
   * Setup event listeners for badge updates
   */
  private setupEventListeners(): void {
    this.badgeUpdateSubscriptionId = this.eventBus.on('dm:badge-update', () => {
      this.updateBadgeCount();
    });
  }

  /**
   * Update DM badge with unread count
   */
  public async updateBadgeCount(): Promise<void> {
    if (!this.badgeElement) return;

    // Only show badge if user is logged in
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      this.badgeElement.style.display = 'none';
      return;
    }

    try {
      const unreadCount = await this.dmService.getUnreadCount();

      if (unreadCount > 0) {
        this.badgeElement.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
        this.badgeElement.style.display = 'inline-flex';
      } else {
        this.badgeElement.style.display = 'none';
      }
    } catch (error) {
      // Silently fail - badge is not critical
      this.badgeElement.style.display = 'none';
    }
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.badgeUpdateSubscriptionId) {
      this.eventBus.off(this.badgeUpdateSubscriptionId);
      this.badgeUpdateSubscriptionId = null;
    }
  }
}
