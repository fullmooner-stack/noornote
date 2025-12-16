/**
 * AnalyticsModal - Detailed Stats Modal for Notes
 * Shows detailed breakdown of all interactions (replies, zaps, reposts, etc.)
 * Uses ModalService for modal infrastructure
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import { encodeNevent } from '../../services/NostrToolsAdapter';
import { ReactionsOrchestrator, type DetailedStats } from '../../services/orchestration/ReactionsOrchestrator';
import { UserProfileService } from '../../services/UserProfileService';
import { Router } from '../../services/Router';
import { ModalService } from '../../services/ModalService';
import { AuthGuard } from '../../services/AuthGuard';
import { escapeHtml } from '../../helpers/escapeHtml';
import { renderUserMention, setupUserMentionHandlers, type UserMentionProfile } from '../../helpers/UserMentionHelper';

export class AnalyticsModal {
  private static instance: AnalyticsModal | null = null;
  private orchestrator: ReactionsOrchestrator;
  private userProfileService: UserProfileService;
  private router: Router;
  private modalService: ModalService;

  private constructor() {
    this.orchestrator = ReactionsOrchestrator.getInstance();
    this.userProfileService = UserProfileService.getInstance();
    this.router = Router.getInstance();
    this.modalService = ModalService.getInstance();
  }

  /**
   * Get singleton instance (create if needed)
   */
  public static getInstance(): AnalyticsModal {
    if (!AnalyticsModal.instance) {
      AnalyticsModal.instance = new AnalyticsModal();
    }
    return AnalyticsModal.instance;
  }

  /**
   * Show modal with analytics for a note
   */
  public async show(noteId: string, rawEvent?: NostrEvent): Promise<void> {
    // Check authentication for viewing detailed analytics (Read-Protected action)
    if (!AuthGuard.requireAuth('view detailed analytics')) {
      return;
    }

    // Show loading state first
    const loadingContent = this.renderLoadingContent();
    this.modalService.show({
      title: 'Analytics',
      content: loadingContent,
      width: '40%',
      height: '40%',
      maxWidth: '90%',
      maxHeight: '50%'
    });

    // Fetch detailed stats
    try {
      const stats = await this.orchestrator.getDetailedStats(noteId);
      const statsContent = await this.renderStatsContent(noteId, stats, rawEvent);

      // Update modal with stats content
      this.modalService.show({
        title: 'Analytics',
        content: statsContent,
        width: '40%',
        height: '40%',
        maxWidth: '90%',
        maxHeight: '50%'
      });

      // Update ISL stats in the DOM (Profile View, Timeline)
      this.updateISLInDOM(noteId, stats);
    } catch (error) {
      console.error('❌ Failed to fetch analytics:', error);
      const errorContent = this.renderErrorContent('Failed to load analytics data');
      this.modalService.show({
        title: 'Analytics',
        content: errorContent,
        width: '40%',
        height: '40%',
        maxWidth: '90%',
        maxHeight: '50%'
      });
    }
  }

  /**
   * Render loading content
   */
  private renderLoadingContent(): string {
    return `
      <div class="modal__loading">
        <div class="loading-spinner"></div>
        <p>Loading analytics data...</p>
      </div>
    `;
  }

  /**
   * Render error content
   */
  private renderErrorContent(message: string): string {
    return `
      <div class="modal__error">
        <p>❌ ${escapeHtml(message)}</p>
      </div>
    `;
  }

  /**
   * Render stats content
   */
  private async renderStatsContent(_noteId: string, stats: DetailedStats, rawEvent?: NostrEvent): Promise<HTMLElement> {
    // Fetch all usernames in parallel
    const allPubkeys = new Set<string>();
    stats.replyEvents.forEach(e => allPubkeys.add(e.pubkey));
    stats.repostEvents.forEach(e => allPubkeys.add(e.pubkey));
    stats.quotedEvents.forEach(e => allPubkeys.add(e.pubkey));
    stats.reactionEvents.forEach(e => allPubkeys.add(e.pubkey));

    // For zaps, extract actual zapper pubkey from description tag
    stats.zapEvents.forEach(e => {
      const descTag = e.tags.find((tag: string[]) => tag[0] === 'description');
      if (descTag && descTag[1]) {
        try {
          const zapRequest = JSON.parse(descTag[1]);
          if (zapRequest.pubkey) {
            allPubkeys.add(zapRequest.pubkey);
          } else {
            allPubkeys.add(e.pubkey);
          }
        } catch (err) {
          allPubkeys.add(e.pubkey);
        }
      } else {
        allPubkeys.add(e.pubkey);
      }
    });

    // Fetch all profiles and build profile map
    const profileMap = new Map<string, UserMentionProfile>();
    await Promise.all(
      Array.from(allPubkeys).map(async (pubkey) => {
        const profile = await this.userProfileService.getUserProfile(pubkey);
        const username = profile.display_name || profile.name || profile.username || 'Anonymous';
        const avatarUrl = profile.picture || '';
        profileMap.set(pubkey, { username, avatarUrl });
      })
    );

    // Build sections HTML (pass profile map)
    const repliesSection = this.renderRepliesSection(stats.replyEvents, profileMap);
    const zapsSection = this.renderZapsSection(stats.zapEvents, profileMap);
    const repostsSection = this.renderRepostsSection(stats.repostEvents, profileMap);
    const quotedSection = this.renderQuotedRepostsSection(stats.quotedEvents, profileMap);
    const likesSection = this.renderLikesSection(stats.reactionEvents, profileMap);

    // Extract client tag if available
    const clientTag = rawEvent?.tags?.find((tag: string[]) => tag[0] === 'client');
    const clientName = clientTag?.[1] || null;
    const clientSection = clientName ? `<div class="analytics-modal__client">via ${escapeHtml(clientName)}</div>` : '';

    // Create container element
    const container = document.createElement('div');
    container.className = 'analytics-content';
    container.innerHTML = `
      ${repliesSection}
      ${zapsSection}
      ${repostsSection}
      ${quotedSection}
      ${likesSection}
      ${clientSection}
    `;

    // Setup handlers
    this.setupHandlers(container);

    return container;
  }

  /**
   * Render Replies section (links to reply notes)
   */
  private renderRepliesSection(replyEvents: NostrEvent[], profileMap: Map<string, UserMentionProfile>): string {
    if (replyEvents.length === 0) {
      return `
        <div class="analytics-modal__section">
          <h2>Replies (0)</h2>
          <div class="analytics-modal__separator"></div>
          <p class="analytics-modal__empty">No replies yet</p>
        </div>
      `;
    }

    const userLinks = replyEvents.map(event => {
      const profile = profileMap.get(event.pubkey) || { username: 'Anonymous', avatarUrl: '' };
      // Note link - navigates to the reply note
      return `<span class="user-mention" data-pubkey="${event.pubkey}"><a href="#" class="mention-link mention-link--bg" data-note-id="${event.id}"><img class="profile-pic profile-pic--mini" src="${profile.avatarUrl}" alt="" />${escapeHtml(profile.username)}</a></span>`;
    }).join(' ');

    return `
      <div class="analytics-modal__section">
        <h2>Replies (${replyEvents.length})</h2>
        <div class="analytics-modal__separator"></div>
        <div class="analytics-modal__list">${userLinks}</div>
      </div>
    `;
  }

  /**
   * Render Zaps section (uses UserMentionHelper)
   */
  private renderZapsSection(zapEvents: NostrEvent[], profileMap: Map<string, UserMentionProfile>): string {
    if (zapEvents.length === 0) {
      return `
        <div class="analytics-modal__section">
          <h2>Zaps (0): 0 Sats</h2>
          <div class="analytics-modal__separator"></div>
          <p class="analytics-modal__empty">No zaps yet</p>
        </div>
      `;
    }

    let totalSats = 0;
    const zapItems = zapEvents.map(event => {
      // Extract actual zapper pubkey from description tag (zap request)
      const descTag = event.tags.find((tag: string[]) => tag[0] === 'description');
      let zapperPubkey = event.pubkey;
      let zapMessage = '';

      if (descTag && descTag[1]) {
        try {
          const zapRequest = JSON.parse(descTag[1]);
          if (zapRequest.pubkey) {
            zapperPubkey = zapRequest.pubkey;
          }
          zapMessage = zapRequest.content || '';
        } catch (e) {
          // Use fallback pubkey
        }
      }

      const profile = profileMap.get(zapperPubkey) || { username: 'Anonymous', avatarUrl: '' };
      const bolt11Tag = event.tags.find((tag: string[]) => tag[0] === 'bolt11');
      const amount = bolt11Tag ? this.parseBolt11Amount(bolt11Tag[1]) : 0;
      totalSats += amount;

      const messageHtml = zapMessage ? ` <span class="analytics-modal__zap-message">(${escapeHtml(zapMessage)})</span>` : '';
      const formattedAmount = this.formatNumber(amount);

      return `
        <div class="analytics-modal__zap-item">
          ${renderUserMention(zapperPubkey, profile)}:
          <span class="analytics-modal__zap-amount">${formattedAmount} Sats</span>${messageHtml}
        </div>
      `;
    }).join('');

    const formattedTotal = this.formatNumber(totalSats);

    return `
      <div class="analytics-modal__section">
        <h2>Zaps (${zapEvents.length}): ${formattedTotal} Sats</h2>
        <div class="analytics-modal__separator"></div>
        <div class="analytics-modal__zap-list">${zapItems}</div>
      </div>
    `;
  }

  /**
   * Render Reposts section (uses UserMentionHelper)
   */
  private renderRepostsSection(repostEvents: NostrEvent[], profileMap: Map<string, UserMentionProfile>): string {
    if (repostEvents.length === 0) {
      return `
        <div class="analytics-modal__section">
          <h2>Reposts (0)</h2>
          <div class="analytics-modal__separator"></div>
          <p class="analytics-modal__empty">No reposts yet</p>
        </div>
      `;
    }

    const userLinks = repostEvents.map(event => {
      const profile = profileMap.get(event.pubkey) || { username: 'Anonymous', avatarUrl: '' };
      return renderUserMention(event.pubkey, profile);
    }).join(' ');

    return `
      <div class="analytics-modal__section">
        <h2>Reposts (${repostEvents.length})</h2>
        <div class="analytics-modal__separator"></div>
        <div class="analytics-modal__list">${userLinks}</div>
      </div>
    `;
  }

  /**
   * Render Quoted Reposts section (links to quote notes)
   */
  private renderQuotedRepostsSection(quotedEvents: NostrEvent[], profileMap: Map<string, UserMentionProfile>): string {
    if (quotedEvents.length === 0) {
      return `
        <div class="analytics-modal__section">
          <h2>Quoted Reposts (0)</h2>
          <div class="analytics-modal__separator"></div>
          <p class="analytics-modal__empty">No quoted reposts yet</p>
        </div>
      `;
    }

    const userLinks = quotedEvents.map(event => {
      const profile = profileMap.get(event.pubkey) || { username: 'Anonymous', avatarUrl: '' };
      // Note link - navigates to the quote note
      return `<span class="user-mention" data-pubkey="${event.pubkey}"><a href="#" class="mention-link mention-link--bg" data-note-id="${event.id}"><img class="profile-pic profile-pic--mini" src="${profile.avatarUrl}" alt="" />${escapeHtml(profile.username)}</a></span>`;
    }).join(' ');

    return `
      <div class="analytics-modal__section">
        <h2>Quoted Reposts (${quotedEvents.length})</h2>
        <div class="analytics-modal__separator"></div>
        <div class="analytics-modal__list">${userLinks}</div>
      </div>
    `;
  }

  /**
   * Render Likes section (grouped by emoji, uses UserMentionHelper)
   */
  private renderLikesSection(reactionEvents: NostrEvent[], profileMap: Map<string, UserMentionProfile>): string {
    if (reactionEvents.length === 0) {
      return `
        <div class="analytics-modal__section">
          <h2>Likes (0)</h2>
          <div class="analytics-modal__separator"></div>
          <p class="analytics-modal__empty">No likes yet</p>
        </div>
      `;
    }

    // Group by emoji
    const emojiGroups = new Map<string, NostrEvent[]>();
    reactionEvents.forEach(event => {
      let emoji = event.content || '❤️';
      if (emoji === '+') {
        emoji = '❤️';
      }
      if (!emojiGroups.has(emoji)) {
        emojiGroups.set(emoji, []);
      }
      emojiGroups.get(emoji)!.push(event);
    });

    // Render each emoji group
    const groupsHtml = Array.from(emojiGroups.entries()).map(([emoji, events]) => {
      const userLinks = events.map(event => {
        const profile = profileMap.get(event.pubkey) || { username: 'Anonymous', avatarUrl: '' };
        return renderUserMention(event.pubkey, profile);
      }).join(' ');

      return `
        <div class="analytics-modal__emoji-group">
          <span class="analytics-modal__emoji">${emoji}:</span>
          <span class="analytics-modal__list">${userLinks}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="analytics-modal__section">
        <h2>Likes (${reactionEvents.length})</h2>
        <div class="analytics-modal__separator"></div>
        ${groupsHtml}
      </div>
    `;
  }

  /**
   * Setup all handlers (UserMentionHelper + note links)
   */
  private setupHandlers(container: HTMLElement): void {
    // Setup profile link handlers via UserMentionHelper
    setupUserMentionHandlers(container);

    // Setup note link handlers (replies, quoted reposts)
    const noteLinks = container.querySelectorAll('[data-note-id]');
    noteLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const noteId = (link as HTMLElement).dataset.noteId;

        if (noteId) {
          this.modalService.hide();
          try {
            const nevent = encodeNevent(noteId);
            this.router.navigate(`/note/${nevent}`);
          } catch (error) {
            console.error('Failed to encode nevent:', error);
          }
        }
      });
    });
  }

  /**
   * Parse bolt11 invoice to get amount in sats
   */
  private parseBolt11Amount(invoice: string): number {
    try {
      const match = invoice.match(/^ln(bc|tb)(\d+)([munp]?)/i);
      if (!match) return 0;

      const amount = parseInt(match[2]);
      const multiplier = match[3]?.toLowerCase();

      let millisats = 0;
      switch (multiplier) {
        case 'm': millisats = amount * 100_000_000; break;
        case 'u': millisats = amount * 100_000; break;
        case 'n': millisats = amount * 100; break;
        case 'p': millisats = amount * 0.1; break;
        default: millisats = amount * 100_000_000_000; break;
      }

      return Math.floor(millisats / 1000);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Format number with comma thousands separator (US format)
   */
  private formatNumber(num: number): string {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Update ISL stats in the DOM after fetching detailed analytics
   * Finds the ISL element by note ID and updates the counts
   */
  private updateISLInDOM(noteId: string, stats: DetailedStats): void {
    // Find ISL container by note ID
    const islContainer = document.querySelector(`.isl[data-note-id="${noteId}"]`);
    if (!islContainer) {
      return;
    }

    // Calculate total zap amount in sats
    let totalZapSats = 0;
    stats.zapEvents.forEach(event => {
      const bolt11Tag = event.tags.find((tag: string[]) => tag[0] === 'bolt11');
      if (bolt11Tag) {
        totalZapSats += this.parseBolt11Amount(bolt11Tag[1]);
      }
    });

    // Update counts in DOM
    const repliesCount = islContainer.querySelector('.isl-reply .isl-count');
    const repostsCount = islContainer.querySelector('.isl-repost .isl-count');
    const quotedRepostsCount = islContainer.querySelector('.isl-quote .isl-count');
    const likesCount = islContainer.querySelector('.isl-like .isl-count');
    const zapsCount = islContainer.querySelector('.isl-zap .isl-count');

    if (repliesCount) {
      repliesCount.textContent = this.formatCountShort(stats.replyEvents.length);
    }
    if (repostsCount) {
      repostsCount.textContent = this.formatCountShort(stats.repostEvents.length);
    }
    if (quotedRepostsCount) {
      quotedRepostsCount.textContent = this.formatCountShort(stats.quotedEvents.length);
    }
    if (likesCount) {
      likesCount.textContent = this.formatCountShort(stats.reactionEvents.length);
    }
    if (zapsCount) {
      zapsCount.textContent = this.formatCountShort(totalZapSats);
    }
  }

  /**
   * Format count for ISL display (K/M abbreviations)
   */
  private formatCountShort(count: number): string {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (count >= 1000) {
      return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return count.toString();
  }

  /**
   * Cleanup and destroy modal
   */
  public destroy(): void {
    this.modalService.hide();
    AnalyticsModal.instance = null;
  }
}
