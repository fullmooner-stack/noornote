/**
 * ArticleProcessor - Long-form content processor (NIP-23, kind 30023)
 * Processes articles as text notes for timeline display
 * Full article rendering is handled by ArticleView component
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import type { ProcessedNote } from '../types/NoteTypes';

export class ArticleProcessor {
  /**
   * Process article event as text note for preview
   * Full rendering is handled by ArticleView when viewing the article directly
   */
  static process(event: NostrEvent): ProcessedNote {
    // Extract article metadata
    const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled Article';
    const summary = event.tags.find(t => t[0] === 'summary')?.[1] || '';

    // For timeline preview, show title and summary
    const previewContent = summary
      ? `# ${title}\n\n${summary}`
      : `# ${title}`;

    return {
      displayType: 'text',
      content: previewContent,
      hasMedia: false,
      isQuoteNote: false,
      isThreadReply: false,
      quotedEventId: null,
      rootEventId: null,
      replyEventId: null
    };
  }
}
