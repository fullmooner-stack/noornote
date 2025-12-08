/**
 * ThreadOrchestrator - Thread/Reply Management
 * Handles reply fetching (children) and parent chain fetching (ancestors)
 *
 * @orchestrator ThreadOrchestrator
 * @purpose Fetch and cache replies + parent chains for notes (SNV, TV, PV)
 * @used-by SingleNoteView, ThreadContextIndicator
 *
 * Architecture:
 * - Fetches replies (kind:1 with #e tag pointing to note) - DOWNWARD
 * - Fetches parent chain (walk up e-tags to root) - UPWARD
 * - Filters out non-replies (mentions)
 * - Cache: 5min TTL
 * - Silent logging
 */

import type { NostrEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { Orchestrator } from './Orchestrator';
import { NostrTransport } from '../transport/NostrTransport';
import { MuteOrchestrator } from './MuteOrchestrator';
import { AuthService } from '../AuthService';
import { SystemLogger } from '../../components/system/SystemLogger';

/** Thread context for displaying ancestors */
export interface ThreadContextItem {
  eventId: string;
  content: string;
  pubkey: string;
  createdAt: number;
  tags: string[][];
}

export interface ThreadContext {
  root: ThreadContextItem | null;       // Original post
  parents: ThreadContextItem[];          // Intermediate replies (between root and current)
  directParent: ThreadContextItem | null; // Direct parent of current note
  hasSkippedReplies: boolean;            // True if parents.length > 0 (show "...")
}

export class ThreadOrchestrator extends Orchestrator {
  private static instance: ThreadOrchestrator;
  private transport: NostrTransport;
  private muteOrchestrator: MuteOrchestrator;
  private authService: AuthService;
  private systemLogger: SystemLogger;

  /** Replies metadata cache (5min TTL) - tracks which events are replies to which notes */
  private repliesMetaCache: Map<string, { replyIds: string[]; lastUpdated: number }> = new Map();
  private fetchingReplies: Map<string, Promise<NostrEvent[]>> = new Map();

  /** Parent chain cache (5min TTL) - thread context metadata */
  private parentChainCache: Map<string, { context: ThreadContext; lastUpdated: number }> = new Map();
  private fetchingParentChain: Map<string, Promise<ThreadContext>> = new Map();

  /** Live reply subscriptions tracking */
  private liveSubscriptions: Map<string, string> = new Map(); // noteId → subId

  private cacheDuration = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    super('ThreadOrchestrator');
    this.transport = NostrTransport.getInstance();
    this.muteOrchestrator = MuteOrchestrator.getInstance();
    this.authService = AuthService.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.systemLogger.info('ThreadOrchestrator', 'Thread Orchestrator at your service');
  }

  public static getInstance(): ThreadOrchestrator {
    if (!ThreadOrchestrator.instance) {
      ThreadOrchestrator.instance = new ThreadOrchestrator();
    }
    return ThreadOrchestrator.instance;
  }

  /**
   * Fetch replies for a note (with caching)
   */
  public async fetchReplies(noteId: string): Promise<NostrEvent[]> {
    // Note: Metadata cache removed - always fetch fresh from relays
    // This ensures consistency without EventCache

    // If already fetching, wait for that request
    if (this.fetchingReplies.has(noteId)) {
      return await this.fetchingReplies.get(noteId)!;
    }

    // Start new fetch
    const fetchPromise = this.fetchRepliesFromRelays(noteId);
    this.fetchingReplies.set(noteId, fetchPromise);

    try {
      const replies = await fetchPromise;

      // Store reply IDs in metadata cache
      this.repliesMetaCache.set(noteId, {
        replyIds: replies.map(r => r.id),
        lastUpdated: Date.now()
      });

      return replies;
    } finally {
      this.fetchingReplies.delete(noteId);
    }
  }

  /**
   * Fetch replies from relays
   * Supports both e-tags (normal notes) and a-tags (addressable events)
   */
  private async fetchRepliesFromRelays(noteId: string): Promise<NostrEvent[]> {
    const relays = this.transport.getReadRelays();

    // Determine if this is an addressable event (a-tag) or regular event (e-tag)
    const isAddressable = noteId.includes(':'); // Format: "kind:pubkey:d-tag"

    const filters: NDKFilter[] = [{
      kinds: [1],
      ...(isAddressable ? { '#a': [noteId] } : { '#e': [noteId] })
    }];

    try {
      const events = await this.transport.fetch(relays, filters, 5000);

      // Filter out non-replies (mentions only)
      let actualReplies = events.filter(event => this.isActualReply(event, noteId));

      // Filter out muted users
      const currentUser = this.authService.getCurrentUser();
      if (currentUser) {
        const mutedPubkeys = await this.muteOrchestrator.getAllMutedUsers(currentUser.pubkey);
        const mutedSet = new Set(mutedPubkeys);
        actualReplies = actualReplies.filter(event => !mutedSet.has(event.pubkey));
      }

      // Sort by timestamp (oldest first for thread display)
      actualReplies.sort((a, b) => a.created_at - b.created_at);

      return actualReplies;
    } catch (error) {
      this.systemLogger.error('ThreadOrchestrator', `Fetch replies failed: ${error}`);
      return [];
    }
  }

  /**
   * Check if event is an actual reply (not just a mention)
   * Accepts all events that reference noteId in e-tags or a-tags (including nested replies)
   * Supports both e-tags (normal notes) and a-tags (addressable events)
   */
  private isActualReply(event: NostrEvent, noteId: string): boolean {
    // Determine tag type based on noteId format
    const isAddressable = noteId.includes(':'); // Format: "kind:pubkey:d-tag"
    const tagType = isAddressable ? 'a' : 'e';

    const tags = event.tags.filter(tag => tag[0] === tagType);
    if (tags.length === 0) return false;

    // Accept any event that references our noteId in tags
    // This includes direct replies (noteId = parent) and nested replies (noteId = root)
    return tags.some(tag => tag[1] === noteId);
  }

  /**
   * Fetch parent chain (ancestors) for a note
   * Walks up the thread to find root and all intermediate parents
   */
  public async fetchParentChain(noteId: string): Promise<ThreadContext> {
    // Check cache first
    const cached = this.parentChainCache.get(noteId);
    if (cached && Date.now() - cached.lastUpdated < this.cacheDuration) {
      return cached.context;
    }

    // If already fetching, wait for that request
    if (this.fetchingParentChain.has(noteId)) {
      return await this.fetchingParentChain.get(noteId)!;
    }

    // Start new fetch
    const fetchPromise = this.fetchParentChainFromRelays(noteId);
    this.fetchingParentChain.set(noteId, fetchPromise);

    try {
      const context = await fetchPromise;
      this.parentChainCache.set(noteId, {
        context,
        lastUpdated: Date.now()
      });
      return context;
    } finally {
      this.fetchingParentChain.delete(noteId);
    }
  }

  /**
   * Fetch parent chain from relays by walking up e-tags
   */
  private async fetchParentChainFromRelays(noteId: string): Promise<ThreadContext> {
    try {
      // Fetch the note itself first
      const relays = this.transport.getReadRelays();
      const filters: NDKFilter[] = [{ ids: [noteId] }];
      const events = await this.transport.fetch(relays, filters, 5000);

      if (events.length === 0) {
        // Note not found
        return {
          root: null,
          parents: [],
          directParent: null,
          hasSkippedReplies: false
        };
      }

      const currentNote = events[0];
      const chain: ThreadContextItem[] = [];
      let noteToProcess = currentNote;
      const maxDepth = 50; // Prevent infinite loops
      let depth = 0;

      // Walk up the parent chain
      while (depth < maxDepth) {
        const parentId = this.extractParentId(noteToProcess);
        if (!parentId) break; // No parent, reached top

        // Check for self-reference (note referencing itself)
        if (parentId === noteToProcess.id) break; // Invalid self-reference, stop

        // Check for circular reference (already seen this parent in chain)
        if (chain.some(item => item.eventId === parentId)) break; // Circular reference, stop

        // Fetch parent note
        const parentFilters: NDKFilter[] = [{ ids: [parentId] }];
        const parentEvents = await this.transport.fetch(relays, parentFilters, 5000);

        if (parentEvents.length === 0) break; // Parent not found

        const parentNote = parentEvents[0];
        chain.push({
          eventId: parentNote.id,
          content: parentNote.content,
          pubkey: parentNote.pubkey,
          createdAt: parentNote.created_at,
          tags: parentNote.tags
        });

        noteToProcess = parentNote;
        depth++;
      }

      // Build context structure
      if (chain.length === 0) {
        return {
          root: null,
          parents: [],
          directParent: null,
          hasSkippedReplies: false
        };
      }

      const directParent = chain[0];
      const root = chain[chain.length - 1];
      const parents = chain.slice(1, -1); // Intermediate replies (between direct parent and root)

      return {
        root: chain.length > 1 ? root : null, // Only show root if it's different from direct parent
        parents,
        directParent,
        hasSkippedReplies: parents.length > 0
      };

    } catch (error) {
      this.systemLogger.error('ThreadOrchestrator', `Fetch parent chain failed: ${error}`);
      return {
        root: null,
        parents: [],
        directParent: null,
        hasSkippedReplies: false
      };
    }
  }

  /**
   * Extract parent event ID from note tags (NIP-10)
   */
  private extractParentId(event: NostrEvent): string | null {
    const eTags = event.tags.filter(tag => tag[0] === 'e');
    if (eTags.length === 0) return null;

    // NIP-10: Look for explicit "reply" marker
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    if (replyTag) {
      return replyTag[1];
    }

    // NIP-10 deprecated positional: if only one e-tag, it's the parent
    if (eTags.length === 1) {
      return eTags[0][1];
    }

    // NIP-10 deprecated positional: if multiple, last is replied-to
    return eTags[eTags.length - 1][1];
  }

  /**
   * Clear cached replies and parent chain for a note
   */
  public clearCache(noteId: string): void {
    this.repliesMetaCache.delete(noteId);
    this.parentChainCache.delete(noteId);
  }

  /**
   * Clear all cached replies and parent chains
   */
  public clearAllCache(): void {
    this.repliesMetaCache.clear();
    this.parentChainCache.clear();
  }

  /**
   * Start live reply subscription for Single Note View
   * @param noteId - Note ID to watch for new replies
   * @param callback - Called when new reply arrives
   */
  public startLiveReplies(noteId: string, callback: (event: NostrEvent) => void): void {
    // Check if already subscribed - if yes, stop old subscription first
    if (this.liveSubscriptions.has(noteId)) {
      this.systemLogger.warn('ThreadOrchestrator', `Already subscribed to live replies for ${noteId}, restarting subscription`);
      this.stopLiveReplies(noteId);
    }

    // Get read relays
    const relays = this.transport.getReadRelays();
    const subId = `live-replies-${noteId}`;

    // Build filter for new replies only (since now)
    const filters: NDKFilter[] = [{
      kinds: [1],           // Only text notes (replies)
      '#e': [noteId],       // Referencing this note
      since: Math.floor(Date.now() / 1000)  // Only new events from now
    }];

    // Subscribe via NostrTransport
    this.transport.subscribeLive(relays, filters, subId, (event, _relay) => {

      // Filter out non-replies (mentions only)
      if (this.isActualReply(event, noteId)) {
        this.systemLogger.info('ThreadOrchestrator', `New live reply received for ${noteId}: ${event.id}`);

        // Update replies metadata cache to include new reply
        const cached = this.repliesMetaCache.get(noteId);
        if (cached) {
          cached.replyIds.push(event.id);
          cached.lastUpdated = Date.now();
        }

        // Notify SingleNoteView
        callback(event);
      }
    });

    // Track subscription
    this.liveSubscriptions.set(noteId, subId);

    this.systemLogger.info('ThreadOrchestrator', `Live replies started for ${noteId}`);
  }

  /**
   * Stop live reply subscription (when leaving SNV)
   * @param noteId - Note ID to stop watching
   */
  public stopLiveReplies(noteId: string): void {
    const subId = this.liveSubscriptions.get(noteId);
    if (!subId) {
      this.systemLogger.warn('ThreadOrchestrator', `No live subscription found for ${noteId}`);
      return;
    }

    // Unsubscribe via NostrTransport
    this.transport.unsubscribeLive(subId);
    this.liveSubscriptions.delete(noteId);

    this.systemLogger.info('ThreadOrchestrator', `Live replies stopped for ${noteId}`);
  }

  // Orchestrator interface implementations (unused for now, required by base class)

  public onui(_data: any): void {
    // Handle UI actions (future: real-time reply subscriptions)
  }

  public onopen(_relay: string): void {
    // Silent operation
  }

  public onmessage(_relay: string, _event: NostrEvent): void {
    // Handle incoming events from subscriptions (future: live reply updates)
  }

  public onerror(relay: string, error: Error): void {
    this.systemLogger.error('ThreadOrchestrator', `Relay error (${relay}): ${error.message}`);
  }

  public onclose(_relay: string): void {
    // Silent operation
  }

  public override destroy(): void {
    // Stop all live subscriptions before cleanup
    this.liveSubscriptions.forEach((subId, noteId) => {
      this.transport.unsubscribeLive(subId);
      this.systemLogger.info('ThreadOrchestrator', `Stopped live subscription for ${noteId}`);
    });
    this.liveSubscriptions.clear();

    this.repliesMetaCache.clear();
    this.fetchingReplies.clear();
    this.parentChainCache.clear();
    this.fetchingParentChain.clear();
    super.destroy();
    this.systemLogger.info('ThreadOrchestrator', 'Destroyed');
  }
}
