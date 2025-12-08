/**
 * Extract Original Note ID from Event
 * For regular notes: returns their ID
 * For reposts (kind 6): extracts the original note ID from tags or embedded event
 *
 * @param event - Nostr event
 * @returns Original note ID (for stats, ISL, etc.)
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';

export function extractOriginalNoteId(event: NostrEvent): string {
  // For regular notes (not reposts), return their ID
  if (event.kind !== 6) {
    return event.id;
  }

  // For reposts (kind 6): extract original note ID

  // Try e-tags first (most common)
  const eTags = event.tags.filter(tag => tag[0] === 'e');
  if (eTags.length > 0) {
    return eTags[0][1];
  }

  // Try parsing embedded event (legacy format)
  try {
    const embedded = JSON.parse(event.content);
    if (embedded && embedded.id) {
      return embedded.id;
    }
  } catch (error) {
    // Not JSON or invalid, ignore
  }

  // Fallback: return repost ID itself (shouldn't happen in practice)
  return event.id;
}
