/**
 * RepostProcessor - Process kind:6 reposts
 * Extracts from: NoteUI.processRepost()
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import type { ProcessedNote } from '../types/NoteTypes';
import { ContentProcessor } from '../../../services/ContentProcessor';

export class RepostProcessor {
  private static contentProcessor = ContentProcessor.getInstance();

  /**
   * Process kind:6 repost
   * SYNCHRONOUS - no blocking calls
   */
  static process(event: NostrEvent): ProcessedNote {
    const reposterProfile = RepostProcessor.contentProcessor.getNonBlockingProfile(event.pubkey);
    const originalAuthorPubkey = RepostProcessor.extractOriginalAuthorPubkey(event);

    let originalAuthorProfile;
    if (originalAuthorPubkey) {
      originalAuthorProfile = RepostProcessor.contentProcessor.getNonBlockingProfile(originalAuthorPubkey);
    }

    let originalContent = 'Reposted content';
    let originalEvent: NostrEvent | null = null;

    try {
      if (event.content && event.content.trim()) {
        originalEvent = JSON.parse(event.content);
        if (originalEvent && originalEvent.content) {
          originalContent = originalEvent.content;
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not parse repost content as JSON');
    }

    // Process content with original event's tags for proper mention handling
    const processedContent = originalEvent
      ? RepostProcessor.contentProcessor.processContentWithTags(originalContent, originalEvent.tags)
      : RepostProcessor.contentProcessor.processContent(originalContent);

    return {
      id: event.id,
      type: 'repost',
      timestamp: event.created_at,
      author: originalAuthorPubkey ? {
        pubkey: originalAuthorPubkey,
        profile: originalAuthorProfile ? {
          name: originalAuthorProfile.name,
          display_name: originalAuthorProfile.display_name,
          picture: originalAuthorProfile.picture
        } : undefined
      } : {
        pubkey: event.pubkey,
        profile: reposterProfile ? {
          name: reposterProfile.name,
          display_name: reposterProfile.display_name,
          picture: reposterProfile.picture
        } : undefined
      },
      reposter: {
        pubkey: event.pubkey,
        profile: reposterProfile ? {
          name: reposterProfile.name,
          display_name: reposterProfile.display_name,
          picture: reposterProfile.picture
        } : undefined
      },
      content: processedContent,
      rawEvent: event,
      repostedEvent: originalEvent || undefined
    };
  }


  /**
   * Extract original author pubkey from repost tags
   */
  private static extractOriginalAuthorPubkey(event: NostrEvent): string | null {
    const pTags = event.tags.filter(tag => tag[0] === 'p');
    return pTags.length > 0 ? pTags[0][1] : null;
  }
}
