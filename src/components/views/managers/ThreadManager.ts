/**
 * ThreadManager
 * Handles thread/reply management for SingleNoteView:
 * - Fetching replies
 * - Building thread tree
 * - Rendering threaded replies with nesting
 * - Live reply updates
 */

import { NoteUI } from '../../ui/NoteUI';
import { ThreadOrchestrator } from '../../../services/orchestration/ThreadOrchestrator';
import { ReactionsOrchestrator } from '../../../services/orchestration/ReactionsOrchestrator';
import { AuthService } from '../../../services/AuthService';
import { SystemLogger } from '../../system/SystemLogger';
import { UserProfileService } from '../../../services/UserProfileService';
import { RelayConfig } from '../../../services/RelayConfig';
import { Router } from '../../../services/Router';
import { encodeNevent } from '../../../services/NostrToolsAdapter';
import { escapeHtml } from '../../../helpers/escapeHtml';
import { fetchNostrEvents } from '../../../helpers/fetchNostrEvents';
import type { NostrEvent } from '@nostr-dev-kit/ndk';

/** Thread node for building reply tree */
export interface ThreadNode {
  event: NostrEvent;
  children: ThreadNode[];
  depth: number;
}

export interface ThreadManagerConfig {
  noteId: string;
  noteAuthor: string;
  container: HTMLElement;
  onStatsUpdate?: (replies: number, quotedReposts: number) => void;
  onLoadZapsList?: (replyId: string, authorPubkey: string, element: HTMLElement) => void;
}

export class ThreadManager {
  private config: ThreadManagerConfig;
  private threadOrchestrator: ThreadOrchestrator;
  private reactionsOrchestrator: ReactionsOrchestrator;
  private authService: AuthService;
  private systemLogger: SystemLogger;
  private profileService: UserProfileService;
  private relayConfig: RelayConfig;

  constructor(config: ThreadManagerConfig) {
    this.config = config;
    this.threadOrchestrator = ThreadOrchestrator.getInstance();
    this.reactionsOrchestrator = ReactionsOrchestrator.getInstance();
    this.authService = AuthService.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.profileService = UserProfileService.getInstance();
    this.relayConfig = RelayConfig.getInstance();
  }

  /**
   * Fetch quoted reposts (kind 1 or kind 6 with 'q' tag referencing this note)
   */
  public async fetchQuotedReposts(): Promise<NostrEvent[]> {
    const relays = this.relayConfig.getReadRelays();

    this.systemLogger.info('ThreadManager', `🔍 Fetching quoted reposts for note ${this.config.noteId.slice(0, 8)}`);

    try {
      const result = await fetchNostrEvents({
        relays,
        kinds: [1, 6], // Text notes and reposts
        tags: { 'q': [this.config.noteId] }, // Quoted reference
        limit: 100
      });

      // Filter to only quoted reposts (those with 'q' tag and content)
      const quotedReposts = result.events.filter(event => {
        const qTags = event.tags.filter(tag => tag[0] === 'q');
        const hasQTag = qTags.some(tag => tag[1] === this.config.noteId);
        const hasContent = event.content.trim().length > 0;

        return hasQTag && hasContent;
      });

      this.systemLogger.info('ThreadManager', `✅ Fetched reposts: ${result.events.length}`);
      this.systemLogger.info('ThreadManager', `✅ Quoted reposts: ${quotedReposts.length}`);
      return quotedReposts;
    } catch (_error) {
      this.systemLogger.error('ThreadManager', `Failed to fetch quoted reposts: ${_error}`);
      return [];
    }
  }

  /**
   * Load and render replies for the note
   */
  public async loadReplies(quotedReposts: NostrEvent[]): Promise<void> {
    const repliesContainer = this.config.container.querySelector('.snv-replies-container');
    if (!repliesContainer) return;

    // Show loading state
    repliesContainer.innerHTML = `
      <div class="snv-replies__loading">
        <div class="loading-spinner"></div>
        <p>Loading replies...</p>
      </div>
    `;

    try {
      // Fetch replies
      const allReplies = await this.threadOrchestrator.fetchReplies(this.config.noteId);

      // Filter out quoted reposts from the same author (own replies with quotes)
      const filteredQuotedReposts = quotedReposts.filter(q => q.pubkey !== this.config.noteAuthor);

      // Filter out any replies that are also quoted reposts (to avoid duplicates)
      const quotedRepostIds = new Set(filteredQuotedReposts.map(q => q.id));
      const replies = allReplies.filter(r => !quotedRepostIds.has(r.id));

      if (replies.length === 0 && filteredQuotedReposts.length === 0) {
        repliesContainer.innerHTML = `
          <div class="snv-replies__empty">
            <p>No replies or quotes yet</p>
          </div>
        `;
        return;
      }

      // Build thread tree from replies
      const threadTree = this.buildThreadTree(replies, this.config.noteId);

      // Count total comments (replies + quoted reposts, not nested)
      const totalComments = replies.length + filteredQuotedReposts.length;

      // Update ISL reply count in main note
      this.updateStats(replies.length, filteredQuotedReposts.length);

      // Render header with total comment count
      repliesContainer.innerHTML = `
        <div class="snv-replies__header">
          <h3>Replies & Quotes (${totalComments})</h3>
        </div>
        <div class="snv-replies__list"></div>
      `;

      const repliesList = repliesContainer.querySelector('.snv-replies__list');
      if (repliesList) {
        // Mix TOP-LEVEL replies and quoted reposts, sorted by timestamp
        // (renderThreadedReply will handle nested children automatically)
        const comments = [
          ...threadTree.map(node => ({
            type: 'reply' as const,
            node: node,
            timestamp: node.event.created_at
          })),
          ...filteredQuotedReposts.map(quote => ({
            type: 'quote' as const,
            event: quote,
            timestamp: quote.created_at
          }))
        ].sort((a, b) => a.timestamp - b.timestamp);

        // Render each comment (top-level reply or quote)
        for (const comment of comments) {
          if (comment.type === 'reply') {
            // Render top-level reply (with nested children)
            this.renderThreadedReply(comment.node, repliesList);
          } else if (comment.type === 'quote') {
            // Render quoted repost (async)
            await this.renderQuotedRepost(comment.event, repliesList);
          }
        }
      }
    } catch (_error) {
      this.systemLogger.error('ThreadManager', `Failed to load replies: ${_error}`);
      repliesContainer.innerHTML = `
        <div class="snv-replies__error">
          <p>Failed to load replies</p>
        </div>
      `;
    }
  }

  /**
   * Build thread tree from flat reply list
   * Groups replies by their parent (creates hierarchical structure)
   */
  private buildThreadTree(replies: NostrEvent[], rootNoteId: string): ThreadNode[] {
    const nodes = new Map<string, ThreadNode>();
    const rootNodes: ThreadNode[] = [];

    // Create nodes for all replies
    replies.forEach(reply => {
      nodes.set(reply.id, {
        event: reply,
        children: [],
        depth: 0
      });
    });

    // Build parent-child relationships
    replies.forEach(reply => {
      const node = nodes.get(reply.id)!;
      const parentId = this.extractReplyParentId(reply);

      if (!parentId || parentId === rootNoteId) {
        // Top-level reply (directly replying to the main note)
        rootNodes.push(node);
      } else {
        // Child reply (replying to another reply)
        const parentNode = nodes.get(parentId);
        if (parentNode) {
          node.depth = parentNode.depth + 1;
          parentNode.children.push(node);
        } else {
          // Parent not found in replies, treat as root-level
          rootNodes.push(node);
        }
      }
    });

    return rootNodes;
  }

  /**
   * Extract parent ID from reply's e-tags (NIP-10)
   */
  private extractReplyParentId(reply: NostrEvent): string | null {
    const eTags = reply.tags.filter(tag => tag[0] === 'e');
    if (eTags.length === 0) return null;

    // NIP-10: Look for explicit "reply" marker
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    if (replyTag) return replyTag[1];

    // NIP-10 deprecated: last e-tag is the replied-to note
    return eTags[eTags.length - 1][1];
  }

  /**
   * Render a threaded reply recursively with indentation
   */
  private renderThreadedReply(node: ThreadNode, container: Element): void {
    const replyElement = this.createReplyElement(node.event, node.depth);
    container.appendChild(replyElement);

    // Recursively render children
    node.children.forEach(childNode => {
      this.renderThreadedReply(childNode, container);
    });
  }

  /**
   * Create a reply element with depth-based indentation
   * Uses NoteUI for consistent rendering (Single Source of Truth!)
   */
  private createReplyElement(reply: NostrEvent, depth: number = 0): HTMLElement {
    // Check if user is logged in (interactions require authentication)
    const isUserLoggedIn = this.authService.getCurrentUser() !== null;

    // Use NoteUI for full note rendering (ISL, ThreadContext, Media, etc.)
    const noteElement = NoteUI.createNoteElement(reply, {
      collapsible: true,        // Enable "Show More" for long replies
      islFetchStats: true,      // Fetch ISL stats (likes, reposts, zaps)
      isLoggedIn: isUserLoggedIn, // Enable interactions only if logged in
      headerSize: 'small',      // Use small header for replies
      depth: 0                  // NoteUI depth (for quoted notes)
    });

    // Load zaps list for this reply
    if (this.config.onLoadZapsList) {
      this.config.onLoadZapsList(reply.id, reply.pubkey, noteElement);
    }

    // Add depth-based indentation styling
    if (depth > 0) {
      noteElement.style.marginLeft = `${depth * 1.5}rem`;
      noteElement.classList.add(`reply-depth-${Math.min(depth, 5)}`);
    }

    return noteElement;
  }

  /**
   * Update ISL stats in main note
   */
  private async updateStats(replies: number, quotedReposts: number): Promise<void> {
    // Wait for initial fetchStats to complete, then override with accurate local count
    const isl = NoteUI.getInteractionStatusLine(this.config.noteId);
    if (isl) {
      await isl.waitForInitialFetch();
      isl.updateStats({
        replies: replies,
        quotedReposts: quotedReposts
      });

      // Also update the cache so Timeline shows correct count
      this.reactionsOrchestrator.updateCachedStats(this.config.noteId, {
        replies: replies,
        quotedReposts: quotedReposts
      });
    }

    // Notify parent
    if (this.config.onStatsUpdate) {
      this.config.onStatsUpdate(replies, quotedReposts);
    }
  }

  /**
   * Update ISL stats after live reply (increment count)
   */
  private updateStatsAfterLiveReply(): void {
    const isl = NoteUI.getInteractionStatusLine(this.config.noteId);
    if (isl) {
      // Get current stats from ISL and increment replies
      const currentStats = isl.getCurrentStats();
      if (currentStats) {
        isl.updateStats({
          replies: currentStats.replies + 1
        });

        // Update cache
        this.reactionsOrchestrator.updateCachedStats(this.config.noteId, {
          replies: currentStats.replies + 1
        });
      }
    }
  }

  /**
   * Append a live reply to the thread
   */
  public appendLiveReply(reply: NostrEvent): void {
    const repliesContainer = this.config.container.querySelector('.snv-replies-container');
    if (!repliesContainer) return;

    let repliesList = this.config.container.querySelector('.snv-replies__list');

    // Check if reply already exists (prevent duplicates from EventBus + live subscription)
    const existingReply = this.config.container.querySelector(`[data-reply-id="${reply.id}"]`);
    if (existingReply) {
      return; // Already rendered, skip
    }

    // If no replies list exists yet (empty state), create the structure
    if (!repliesList) {
      repliesContainer.innerHTML = `
        <div class="snv-replies__header">
          <h3>Replies & Quotes (1)</h3>
        </div>
        <div class="snv-replies__list"></div>
      `;
      repliesList = repliesContainer.querySelector('.snv-replies__list');
    } else {
      // Update count in existing header
      const header = repliesContainer.querySelector('.snv-replies__header h3');
      if (header) {
        const match = header.textContent?.match(/\((\d+)\)/);
        if (match) {
          const currentCount = parseInt(match[1], 10);
          header.textContent = `Replies & Quotes (${currentCount + 1})`;
        }
      }
    }

    if (!repliesList) return;

    const replyElement = this.createReplyElement(reply, 0);

    // Add pending state (will be confirmed later)
    replyElement.classList.add('reply-pending');
    replyElement.dataset.replyId = reply.id;

    repliesList.appendChild(replyElement);

    // Update ISL stats
    this.updateStatsAfterLiveReply();
  }

  /**
   * Confirm a pending reply (remove pending state)
   */
  public confirmReply(replyId: string): void {
    const repliesList = this.config.container.querySelector('.snv-replies__list');
    if (!repliesList) return;

    const replyElement = repliesList.querySelector(`[data-reply-id="${replyId}"]`);
    if (replyElement) {
      replyElement.classList.remove('reply-pending');
      replyElement.classList.add('reply-confirmed');
    }
  }

  /**
   * Render a quoted repost
   * Similar to QuotedRepostRenderer.renderQuotedRepost but synchronous
   */
  private async renderQuotedRepost(quoteEvent: NostrEvent, container: Element): Promise<void> {
    // Remove nostr:nevent/note links from content
    const cleanedEvent = {
      ...quoteEvent,
      content: quoteEvent.content.replace(/nostr:(nevent|note|nprofile|npub)[a-z0-9]+/gi, '').trim()
    };

    // Create wrapper for quote
    const quoteWrapper = document.createElement('div');
    quoteWrapper.className = 'snv-quoted-repost';
    quoteWrapper.dataset.eventId = quoteEvent.id;

    // Fetch author's profile for header
    const profile = await this.profileService.getUserProfile(quoteEvent.pubkey);
    const username = profile?.display_name || profile?.name || 'Anonymous';

    // Convert hex ID to nevent for navigation link (NostrToolsAdapter returns without 'nostr:' prefix)
    const nevent = encodeNevent(quoteEvent.id, [], quoteEvent.pubkey);

    // Create "quoted this note:" header - entire line is clickable
    const quoteHeader = document.createElement('div');
    quoteHeader.className = 'snv-quoted-repost__header';
    quoteHeader.innerHTML = `<a href="/note/${nevent}" class="snv-quoted-repost__link"><strong>${escapeHtml(username)}</strong> quoted this note:</a>`;

    // Add click handler to prevent default and use router navigation
    const link = quoteHeader.querySelector('.snv-quoted-repost__link') as HTMLAnchorElement;
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const router = Router.getInstance();
        router.navigate(`/note/${nevent}`);
      });
    }

    // Use NoteUI to render the quote like a normal reply
    const noteElement = NoteUI.createNoteElement(cleanedEvent, {
      collapsible: false,
      islFetchStats: false,
      isLoggedIn: false,
      headerSize: 'small',
      depth: 0
    });

    // Assemble: header + note
    quoteWrapper.appendChild(quoteHeader);
    quoteWrapper.appendChild(noteElement);
    container.appendChild(quoteWrapper);
  }
}
