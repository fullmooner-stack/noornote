/**
 * ArticlePreviewRenderer Service
 * Single responsibility: Render long-form article previews (NIP-23)
 * Used by NoteUI and SingleNoteView when encountering naddr references
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import { LongFormOrchestrator } from './orchestration/LongFormOrchestrator';
import { Router } from './Router';

export class ArticlePreviewRenderer {
  private static instance: ArticlePreviewRenderer;
  private orchestrator: LongFormOrchestrator;

  private constructor() {
    this.orchestrator = LongFormOrchestrator.getInstance();
  }

  static getInstance(): ArticlePreviewRenderer {
    if (!ArticlePreviewRenderer.instance) {
      ArticlePreviewRenderer.instance = new ArticlePreviewRenderer();
    }
    return ArticlePreviewRenderer.instance;
  }

  /**
   * Render article preview card (NON-BLOCKING)
   * Creates skeleton immediately, fetches in background
   */
  public renderArticlePreview(naddrRef: string, container: Element): void {
    const skeleton = this.createArticleSkeleton();
    skeleton.dataset.naddrRef = naddrRef;
    container.appendChild(skeleton);

    // Fetch article in background
    this.fetchAndRenderArticle(naddrRef, skeleton);
  }

  /**
   * Fetch article and update DOM when ready (background task)
   */
  private async fetchAndRenderArticle(naddrRef: string, skeleton: HTMLElement): Promise<void> {
    try {
      const event = await this.orchestrator.fetchAddressableEvent(naddrRef);

      if (event) {
        const previewCard = this.createArticlePreviewCard(event, naddrRef);
        skeleton.replaceWith(previewCard);
      } else {
        const errorElement = this.createArticleError();
        skeleton.replaceWith(errorElement);
      }
    } catch (error) {
      console.error('❌ Article fetch failed:', error);
      skeleton.remove();
    }
  }

  /**
   * Create article preview card with horizontal layout
   * Layout: [Image] [Title + Summary]
   */
  private createArticlePreviewCard(event: NostrEvent, naddrRef: string): HTMLElement {
    const metadata = LongFormOrchestrator.extractArticleMetadata(event);

    const card = document.createElement('div');
    card.className = 'article-preview-card';

    // Make entire card clickable
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateToArticle(naddrRef);
    });

    card.innerHTML = `
      ${metadata.image ? `
        <div class="article-preview-image">
          <img src="${metadata.image}" alt="${metadata.title}" loading="lazy" />
        </div>
      ` : ''}
      <div class="article-preview-content">
        <h3 class="article-preview-title">${this.escapeHtml(metadata.title)}</h3>
        ${metadata.summary ? `<p class="article-preview-summary">${this.escapeHtml(metadata.summary)}</p>` : ''}
      </div>
    `;

    return card;
  }

  /**
   * Navigate to article view
   */
  private navigateToArticle(naddrRef: string): void {
    // Remove nostr: prefix for URL
    const cleanNaddr = naddrRef.replace(/^nostr:/, '');
    const router = Router.getInstance();
    router.navigate(`/article/${cleanNaddr}`);
  }

  /**
   * Create error element for failed article fetch
   */
  private createArticleError(): HTMLElement {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'article-preview-error';
    errorDiv.innerHTML = `
      <div class="article-error-content">
        <span class="error-icon">⚠️</span>
        <span class="error-text">Failed to load article</span>
      </div>
    `;
    return errorDiv;
  }

  /**
   * Create skeleton loader for article preview during fetch
   */
  private createArticleSkeleton(): HTMLElement {
    const skeleton = document.createElement('div');
    skeleton.className = 'article-preview-skeleton';

    skeleton.innerHTML = `
      <div class="skeleton-image"></div>
      <div class="skeleton-content">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-summary"></div>
        <div class="skeleton-line skeleton-summary short"></div>
      </div>
    `;

    return skeleton;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
