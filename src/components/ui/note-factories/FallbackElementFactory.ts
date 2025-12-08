/**
 * FallbackElementFactory - Creates fallback UI elements
 * Handles error states and edge cases (max depth, processing failures)
 * Extracts from: NoteUI.createErrorNoteElement() and createMaxDepthElement()
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import { Router } from '../../../services/Router';
import { encodeNevent } from '../../../services/NostrToolsAdapter';

export class FallbackElementFactory {
  /**
   * Create fallback element when note processing fails
   */
  static createErrorElement(event: NostrEvent, _error: any): HTMLElement {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'note-card note-card--error';
    errorDiv.dataset.eventId = event.id;

    errorDiv.innerHTML = `
      <div class="note-error">
        <div class="error-header">
          <span class="error-icon">⚠️</span>
          <span class="error-message">Note can't be rendered</span>
        </div>
        <div class="error-details">
          <small>ID: ${event.id.slice(0, 12)}... | Kind: ${event.kind}</small>
        </div>
      </div>
    `;

    return errorDiv;
  }

  /**
   * Create element when max nesting depth is reached
   */
  static createMaxDepthElement(event: NostrEvent): HTMLElement {
    const maxDepthDiv = document.createElement('div');
    maxDepthDiv.className = 'quote-max-depth';
    maxDepthDiv.dataset.eventId = event.id;

    maxDepthDiv.innerHTML = `
      <div class="max-depth-content">
        <span class="depth-icon">📄</span>
        <span class="depth-text">Quoted note (max depth reached)</span>
        <small class="depth-id">ID: ${event.id.slice(0, 12)}...</small>
      </div>
    `;

    // Make it clickable to view full note in new context
    maxDepthDiv.style.cursor = 'pointer';
    maxDepthDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      const router = Router.getInstance();
      const nevent = encodeNevent(event.id);
      router.navigate(`/note/${nevent}`);
    });

    return maxDepthDiv;
  }
}
