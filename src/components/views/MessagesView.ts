/**
 * MessagesView Component
 * NIP-17 Private Direct Messages - Conversations List
 *
 * @view MessagesView
 * @purpose Display list of DM conversations
 * @used-by App.ts via Router
 */

import { View } from './View';
import { DMService } from '../../services/dm/DMService';
import type { DMConversation } from '../../services/dm/DMStore';
import { UserProfileService } from '../../services/UserProfileService';
import { EventBus } from '../../services/EventBus';
import { Router } from '../../services/Router';
import { SystemLogger } from '../system/SystemLogger';
import { AuthService } from '../../services/AuthService';
import { setupUserMentionHandlers } from '../../helpers/UserMentionHelper';
import { InfiniteScroll } from '../ui/InfiniteScroll';

const BATCH_SIZE = 15;

export class MessagesView extends View {
  private container: HTMLElement;
  private dmService: DMService;
  private userProfileService: UserProfileService;
  private eventBus: EventBus;
  private router: Router;
  private systemLogger: SystemLogger;
  private authService: AuthService;
  private conversations: DMConversation[] = [];
  private isLoading: boolean = false;
  private currentOffset: number = 0;
  private hasMoreConversations: boolean = true;
  private infiniteScroll: InfiniteScroll;
  private inboxRelays: string[] = [];
  private readRelays: string[] = [];

  constructor() {
    super();

    this.container = document.createElement('div');
    this.container.className = 'messages-view';
    this.dmService = DMService.getInstance();
    this.userProfileService = UserProfileService.getInstance();
    this.eventBus = EventBus.getInstance();
    this.router = Router.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.authService = AuthService.getInstance();
    this.infiniteScroll = new InfiniteScroll(() => this.handleLoadMore(), {
      loadingMessage: 'Loading more conversations...'
    });

    this.render();
    this.setupInfiniteScroll();
    this.loadConversationsBatch();

    // Listen for new messages - refresh from start
    this.eventBus.on('dm:new-message', () => {
      this.refreshConversations();
    });

    // Listen for badge updates - refresh from start
    this.eventBus.on('dm:badge-update', () => {
      this.refreshConversations();
    });
  }

  /**
   * Render the messages view structure
   */
  private render(): void {
    this.container.innerHTML = `
      <div class="messages-view__header">
        <h1>Messages</h1>
        <button class="btn btn--medium messages-view__compose-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Message
        </button>
      </div>
      <div class="messages-view__content">
        <div class="messages-view__list">
          <div class="messages-view__loading">Loading conversations...</div>
        </div>
      </div>
    `;

    // Setup compose button
    const composeBtn = this.container.querySelector('.messages-view__compose-btn');
    composeBtn?.addEventListener('click', () => this.openComposeModal());
  }

  /**
   * Setup infinite scroll on the list container
   */
  private setupInfiniteScroll(): void {
    const list = this.container.querySelector('.messages-view__list');
    if (list) {
      this.infiniteScroll.observe(list as HTMLElement);
    }
  }

  /**
   * Handle load more (infinite scroll trigger)
   */
  private async handleLoadMore(): Promise<void> {
    if (this.isLoading || !this.hasMoreConversations) return;

    this.systemLogger.info('MessagesView', '⏳ Loading more conversations...');
    await this.loadConversationsBatch();
  }

  /**
   * Refresh conversations from start (for new messages/badge updates)
   */
  private async refreshConversations(): Promise<void> {
    // Reset pagination
    this.currentOffset = 0;
    this.hasMoreConversations = true;
    this.conversations = [];

    // Clear list
    const list = this.container.querySelector('.messages-view__list');
    if (list) {
      list.innerHTML = '<div class="messages-view__loading">Loading conversations...</div>';
    }

    // Reload
    await this.loadConversationsBatch();
  }

  /**
   * Load a batch of conversations
   */
  private async loadConversationsBatch(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    const isInitialLoad = this.currentOffset === 0;

    try {
      // Ensure DM service is started (idempotent)
      await this.dmService.start();

      // Fetch relay info on initial load
      if (isInitialLoad) {
        this.inboxRelays = await this.dmService.getCurrentInboxRelays();
        this.readRelays = this.dmService.getReadRelays();
      }

      // Show loading indicator for subsequent loads
      if (!isInitialLoad) {
        this.infiniteScroll.showLoading();
      }

      // Get batch of conversations
      const batch = await this.dmService.getConversations(BATCH_SIZE, this.currentOffset);

      // Check if we have more
      if (batch.length < BATCH_SIZE) {
        this.hasMoreConversations = false;
      }

      // Add to our list
      this.conversations.push(...batch);
      this.currentOffset += batch.length;

      this.systemLogger.info('MessagesView', `Loaded ${batch.length} conversations (total: ${this.conversations.length})`);

      // Render the batch
      await this.renderConversationsBatch(batch, isInitialLoad);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (this.conversations.length === 0) {
        this.systemLogger.error('MessagesView', `Failed to load conversations: ${errorMsg}`);
        this.renderError();
      } else {
        this.systemLogger.warn('MessagesView', `Error loading more conversations: ${errorMsg}`);
      }
    } finally {
      this.isLoading = false;
      this.infiniteScroll.hideLoading();
      this.infiniteScroll.refresh();
    }
  }

  /**
   * Render a batch of conversations
   */
  private async renderConversationsBatch(batch: DMConversation[], isInitialLoad: boolean): Promise<void> {
    const list = this.container.querySelector('.messages-view__list');
    if (!list) return;

    // Handle empty state
    if (isInitialLoad && batch.length === 0) {
      list.innerHTML = `
        <div class="messages-view__empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          <p>No messages yet</p>
          <p class="text-muted">Start a conversation by clicking "New Message"</p>
        </div>
      `;
      return;
    }

    // Clear loading message on initial load
    if (isInitialLoad) {
      list.innerHTML = '';
    }

    // Render each conversation item
    const results = await Promise.allSettled(
      batch.map(conv => this.renderConversationItem(conv))
    );

    // Append successful results and setup hover cards for each new item
    const conversationElements = results
      .filter((r): r is PromiseFulfilledResult<HTMLElement> => r.status === 'fulfilled')
      .map(r => r.value);

    conversationElements.forEach(el => {
      list.appendChild(el);
      // Setup hover cards only for this new element
      setupUserMentionHandlers(el);
    });
  }

  /**
   * Render a single conversation item
   */
  private async renderConversationItem(conversation: DMConversation): Promise<HTMLElement> {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (conversation.unreadCount > 0) {
      item.classList.add('conversation-item--unread');
    }

    // Fetch profile info (with fallback)
    const fallbackName = conversation.pubkey.slice(0, 8) + '...';
    let displayName = fallbackName;
    let avatarUrl = '';

    try {
      const profile = await this.userProfileService.getUserProfile(conversation.pubkey);
      if (profile) {
        displayName = profile.display_name || profile.name || fallbackName;
        avatarUrl = profile.picture || '';
      }
    } catch {
      // Use fallback values
    }

    // Format timestamp
    const timeAgo = this.formatTimeAgo(conversation.lastMessageAt);

    // Avatar: use image if available, otherwise letter placeholder
    const avatarHtml = avatarUrl
      ? `<img class="conversation-item__avatar-img" src="${avatarUrl}" alt="" />`
      : `<div class="conversation-item__avatar-placeholder">${displayName.charAt(0).toUpperCase()}</div>`;

    // Format relay URLs for display (strip wss:// prefix, max 3 each)
    const inboxDisplay = this.inboxRelays
      .slice(0, 3)
      .map(r => r.replace('wss://', ''))
      .join(', ');
    const readDisplay = this.readRelays
      .slice(0, 3)
      .map(r => r.replace('wss://', ''))
      .join(', ');

    // Use user-mention pattern for hover card support
    item.innerHTML = `
      <div class="user-mention conversation-item__user" data-pubkey="${conversation.pubkey}">
        ${avatarHtml}
        <div class="conversation-item__content">
          <div class="conversation-item__header">
            <span class="conversation-item__name">${this.escapeHtml(displayName)}</span>
            <span class="conversation-item__time">${timeAgo}</span>
          </div>
          <div class="conversation-item__preview">
            ${this.escapeHtml(conversation.lastMessagePreview)}
          </div>
          <div class="conversation-item__relays">
            NIP-17: ${inboxDisplay}${this.inboxRelays.length > 3 ? '...' : ''} | Legacy: ${readDisplay}${this.readRelays.length > 3 ? '...' : ''}
          </div>
        </div>
      </div>
      ${conversation.unreadCount > 0 ? `
        <div class="conversation-item__badge">${conversation.unreadCount}</div>
      ` : ''}
    `;

    // Click handler to open conversation
    item.addEventListener('click', () => {
      this.openConversation(conversation.pubkey);
    });

    return item;
  }

  /**
   * Open a conversation
   */
  private openConversation(partnerPubkey: string): void {
    // Mark as read
    this.dmService.markAsRead(partnerPubkey);

    // Navigate to conversation view
    this.router.navigate(`/messages/${partnerPubkey}`);
  }

  /**
   * Open compose modal for new message
   */
  private openComposeModal(): void {
    // TODO: Implement compose modal
    this.systemLogger.info('MessagesView', 'Compose modal not yet implemented');
  }

  /**
   * Render error state
   */
  private renderError(): void {
    const list = this.container.querySelector('.messages-view__list');
    if (!list) return;

    list.innerHTML = `
      <div class="messages-view__error">
        <p>Failed to load messages</p>
        <button class="btn btn--medium" onclick="location.reload()">Retry</button>
      </div>
    `;
  }

  /**
   * Format timestamp as "time ago"
   */
  private formatTimeAgo(timestamp: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(timestamp * 1000).toLocaleDateString();
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get container element for mounting
   */
  public getElement(): HTMLElement {
    return this.container;
  }

  /**
   * Cleanup on unmount
   */
  public destroy(): void {
    this.infiniteScroll.destroy();
    this.eventBus.off('dm:new-message');
    this.eventBus.off('dm:badge-update');
  }
}
