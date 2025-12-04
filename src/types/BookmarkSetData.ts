/**
 * BookmarkSetData - Version 2 Format for NIP-51 Bookmark Sets
 *
 * This is THE format for bookmarks everywhere:
 * - localStorage
 * - File (~/.noornote/{npub}/bookmarks.json)
 * - Relays (kind:30003 events)
 */

export interface BookmarkTag {
  type: 'e' | 'a' | 't' | 'r';
  value: string;
}

export interface BookmarkSet {
  kind: 30003;
  d: string;           // d-tag value (category name, "" = root)
  title: string;       // Display name
  publicTags: BookmarkTag[];
  privateTags: BookmarkTag[];
}

export interface BookmarkSetData {
  version: 2;
  sets: BookmarkSet[];
  metadata: {
    setOrder: string[];      // Order of d-tags for UI
    lastModified: number;
  };
}
