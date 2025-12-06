/**
 * ConversationView Component
 * NIP-17 Private Direct Messages - Single Conversation Thread
 *
 * @view ConversationView
 * @purpose Display message thread with a single user
 * @used-by App.ts via Router
 */

import { View } from './View';
import { DMService } from '../../services/dm/DMService';
import type { DMMessage } from '../../services/dm/DMStore';
import { UserProfileService } from '../../services/UserProfileService';
import { EventBus } from '../../services/EventBus';
import { Router } from '../../services/Router';
import { SystemLogger } from '../system/SystemLogger';
import { AuthService } from '../../services/AuthService';

export class ConversationView extends View {
  private container: HTMLElement;
  private dmService: DMService;
  private userProfileService: UserProfileService;
  private eventBus: EventBus;
  private router: Router;
  private systemLogger: SystemLogger;
  private authService: AuthService;
  private partnerPubkey: string;
  private messages: DMMessage[] = [];
  private isLoading: boolean = true;
  private isSending: boolean = false;
  private partnerProfile: { displayName: string; avatarUrl: string } | null = null;

  constructor(partnerPubkey: string) {
    super();

    this.partnerPubkey = partnerPubkey;
    this.container = document.createElement('div');
    this.container.className = 'conversation-view';
    this.dmService = DMService.getInstance();
    this.userProfileService = UserProfileService.getInstance();
    this.eventBus = EventBus.getInstance();
    this.router = Router.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.authService = AuthService.getInstance();

    this.render();
    this.loadConversation();

    // Listen for new messages in this conversation
    this.eventBus.on('dm:new-message', (data: { message: DMMessage; conversationWith: string }) => {
      if (data.conversationWith === this.partnerPubkey) {
        this.messages.push(data.message);
        this.renderMessages();
        this.scrollToBottom();
      }
    });
  }

  /**
   * Render the conversation view structure
   */
  private render(): void {
    this.container.innerHTML = `
      <div class="conversation-view__header">
        <button class="conversation-view__back-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="conversation-view__user">
          <div class="conversation-view__avatar"></div>
          <span class="conversation-view__name">Loading...</span>
        </div>
      </div>
      <div class="conversation-view__messages">
        <div class="conversation-view__loading">Loading messages...</div>
      </div>
      <div class="conversation-view__input">
        <textarea
          class="conversation-view__textarea"
          placeholder="Type a message..."
          rows="1"
        ></textarea>
        <button class="btn btn--medium conversation-view__send-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    `;

    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Back button
    const backBtn = this.container.querySelector('.conversation-view__back-btn');
    backBtn?.addEventListener('click', () => {
      this.router.navigate('/messages');
    });

    // Textarea auto-resize and send button enable
    const textarea = this.container.querySelector('.conversation-view__textarea') as HTMLTextAreaElement;
    const sendBtn = this.container.querySelector('.conversation-view__send-btn') as HTMLButtonElement;

    textarea?.addEventListener('input', () => {
      // Auto-resize
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';

      // Enable/disable send button
      sendBtn.disabled = !textarea.value.trim();
    });

    // Send on Enter (without Shift)
    textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (textarea.value.trim()) {
          this.sendMessage();
        }
      }
    });

    // Send button click
    sendBtn?.addEventListener('click', () => {
      if (!this.isSending && textarea.value.trim()) {
        this.sendMessage();
      }
    });
  }

  /**
   * Load conversation data
   */
  private async loadConversation(): Promise<void> {
    this.isLoading = true;

    try {
      // Load partner profile
      const profile = await this.userProfileService.getUserProfile(this.partnerPubkey);
      this.partnerProfile = {
        displayName: profile?.display_name || profile?.name || this.partnerPubkey.slice(0, 8) + '...',
        avatarUrl: profile?.picture || ''
      };

      // Update header
      this.updateHeader();

      // Mark conversation as read
      await this.dmService.markAsRead(this.partnerPubkey);

      // Load messages
      this.messages = await this.dmService.getMessages(this.partnerPubkey);

      // Render messages
      this.renderMessages();
      this.scrollToBottom();
    } catch (error) {
      this.systemLogger.error('ConversationView', 'Failed to load conversation:', error);
      this.renderError();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Update header with partner info
   */
  private updateHeader(): void {
    if (!this.partnerProfile) return;

    const avatarEl = this.container.querySelector('.conversation-view__avatar');
    const nameEl = this.container.querySelector('.conversation-view__name');

    if (avatarEl) {
      if (this.partnerProfile.avatarUrl) {
        avatarEl.innerHTML = `<img src="${this.partnerProfile.avatarUrl}" alt="${this.partnerProfile.displayName}" />`;
      } else {
        avatarEl.innerHTML = `<div class="avatar-placeholder">${this.partnerProfile.displayName.charAt(0).toUpperCase()}</div>`;
      }
    }

    if (nameEl) {
      nameEl.textContent = this.partnerProfile.displayName;
    }
  }

  /**
   * Render messages list
   */
  private renderMessages(): void {
    const messagesContainer = this.container.querySelector('.conversation-view__messages');
    if (!messagesContainer) return;

    if (this.messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="conversation-view__empty">
          <p>No messages yet</p>
          <p class="text-muted">Send a message to start the conversation</p>
        </div>
      `;
      return;
    }

    messagesContainer.innerHTML = this.messages.map(msg => this.renderMessage(msg)).join('');
  }

  /**
   * Render a single message
   */
  private renderMessage(message: DMMessage): string {
    const isOwn = message.isMine;
    const time = this.formatTime(message.createdAt);

    return `
      <div class="message ${isOwn ? 'message--own' : 'message--other'}">
        <div class="message__content">${this.escapeHtml(message.content)}</div>
        <div class="message__meta">
          <span class="message__time">${time}</span>
        </div>
      </div>
    `;
  }

  /**
   * Send a message
   */
  private async sendMessage(): Promise<void> {
    const textarea = this.container.querySelector('.conversation-view__textarea') as HTMLTextAreaElement;
    const sendBtn = this.container.querySelector('.conversation-view__send-btn') as HTMLButtonElement;

    const content = textarea.value.trim();
    if (!content || this.isSending) return;

    this.isSending = true;
    sendBtn.disabled = true;

    try {
      const success = await this.dmService.sendMessage(this.partnerPubkey, content);

      if (success) {
        // Clear input
        textarea.value = '';
        textarea.style.height = 'auto';

        this.systemLogger.info('ConversationView', 'Message sent');
      } else {
        this.systemLogger.error('ConversationView', 'Failed to send message');
      }
    } catch (error) {
      this.systemLogger.error('ConversationView', 'Error sending message:', error);
    } finally {
      this.isSending = false;
      sendBtn.disabled = !textarea.value.trim();
    }
  }

  /**
   * Scroll to bottom of messages
   */
  private scrollToBottom(): void {
    const messagesContainer = this.container.querySelector('.conversation-view__messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  /**
   * Render error state
   */
  private renderError(): void {
    const messagesContainer = this.container.querySelector('.conversation-view__messages');
    if (!messagesContainer) return;

    messagesContainer.innerHTML = `
      <div class="conversation-view__error">
        <p>Failed to load messages</p>
        <button class="btn btn--medium" onclick="location.reload()">Retry</button>
      </div>
    `;
  }

  /**
   * Format timestamp as time (US format with year, line break before time)
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
      return timeStr;
    }

    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    return `${dateStr}<br>${timeStr}`;
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
    this.eventBus.off('dm:new-message');
  }
}
