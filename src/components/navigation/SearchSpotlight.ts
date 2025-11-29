/**
 * Search Spotlight
 * Spotlight-style modal for search and navigation
 */

import { Router } from '../../services/Router';
import { EventBus } from '../../services/EventBus';

export class SearchSpotlight {
  private element: HTMLElement;
  private router: Router;
  private eventBus: EventBus;
  private isOpen: boolean = false;
  private inputElement: HTMLInputElement | null = null;
  private suggestionsElement: HTMLElement | null = null;
  private recentURLs: string[] = [];
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private selectedSuggestionIndex: number = -1;

  constructor() {
    this.router = Router.getInstance();
    this.eventBus = EventBus.getInstance();
    this.element = this.createElement();

    // ESC handler with capture phase - fires BEFORE ModalService ESC handler
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this.escHandler, { capture: true });

    this.setupEventListeners();
    // Don't append element here - only append on open()
  }

  private createElement(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'search-spotlight';

    modal.innerHTML = `
      <div class="search-spotlight__overlay"></div>
      <div class="search-spotlight__content">
        <div class="search-spotlight__input-wrapper">
          <input
            type="text"
            class="input input--monospace"
            placeholder="Enter URL path (e.g., /profile, /note/...)"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="search-spotlight__controls">
          <button class="search-spotlight__btn search-spotlight__btn--back" title="Go Back (Cmd+ArrowLeft)" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <button class="search-spotlight__btn search-spotlight__btn--forward" title="Go Forward (Cmd+ArrowRight)" disabled>
            Forward
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
        <div class="search-spotlight__suggestions"></div>
      </div>
    `;

    return modal;
  }

  private setupEventListeners(): void {
    // Overlay click to close
    const overlay = this.element.querySelector('.search-spotlight__overlay');
    overlay?.addEventListener('click', () => this.close());

    // Input element
    this.inputElement = this.element.querySelector('.input');

    if (this.inputElement) {
      // Keyboard navigation for input
      this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.navigateToSelectedOrInput();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.selectNextSuggestion();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.selectPreviousSuggestion();
        }
      });

      // Input changes for suggestions
      this.inputElement.addEventListener('input', () => {
        this.selectedSuggestionIndex = -1; // Reset selection on input
        this.updateSuggestions();
      });
    }

    // Back/Forward buttons
    const backBtn = this.element.querySelector('.search-spotlight__btn--back');
    const forwardBtn = this.element.querySelector('.search-spotlight__btn--forward');

    backBtn?.addEventListener('click', () => {
      this.router.back();
      this.updateNavigationButtons();
    });

    forwardBtn?.addEventListener('click', () => {
      this.router.forward();
      this.updateNavigationButtons();
    });

    // Suggestions element
    this.suggestionsElement = this.element.querySelector('.search-spotlight__suggestions');
  }

  public open(): void {
    if (this.isOpen) return;

    this.isOpen = true;
    document.body.appendChild(this.element);

    // Load recent URLs from history
    this.recentURLs = this.router.getHistory();

    // Update navigation buttons state
    this.updateNavigationButtons();

    // Set placeholder
    if (this.inputElement) {
      this.inputElement.value = '';
      this.inputElement.placeholder = 'Search: (npub / nevent / full text)';
      this.inputElement.focus();
    }

    // Show suggestions
    this.updateSuggestions();
  }

  public close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.element.remove();

    if (this.inputElement) {
      this.inputElement.value = '';
    }

    this.selectedSuggestionIndex = -1;
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private async navigateToInputURL(): Promise<void> {
    if (!this.inputElement) return;

    let input = this.inputElement.value.trim();
    if (!input) return;

    // Check if input is external URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
      await this.openExternalURL(input);
      this.close();
      return;
    }

    // Check if input is npub format
    if (input.startsWith('npub1') && input.length === 63) {
      // Navigate to profile
      this.router.navigate(`/profile/${input}`);
      this.close();
      return;
    }

    // Check if input is nevent format
    if (input.startsWith('nevent1')) {
      // Navigate to note
      this.router.navigate(`/note/${input}`);
      this.close();
      return;
    }

    // Check if input is internal route (starts with /)
    if (input.startsWith('/')) {
      // Navigate to internal route
      this.router.navigate(input);
      this.close();
      return;
    }

    // Otherwise, treat as full-text search query
    this.eventBus.emit('globalSearch:start', { query: input });
    this.close();
  }

  /**
   * Open external URL in system default browser
   */
  private async openExternalURL(url: string): Promise<void> {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      console.log('✓ Opened external URL:', url);
    } catch (error) {
      console.error('Failed to open external URL:', error);
    }
  }

  private updateNavigationButtons(): void {
    const backBtn = this.element.querySelector('.search-spotlight__btn--back') as HTMLButtonElement;
    const forwardBtn = this.element.querySelector('.search-spotlight__btn--forward') as HTMLButtonElement;

    if (backBtn) {
      backBtn.disabled = !this.router.canGoBack();
    }

    if (forwardBtn) {
      forwardBtn.disabled = !this.router.canGoForward();
    }
  }

  private updateSuggestions(): void {
    if (!this.suggestionsElement || !this.inputElement) return;

    const query = this.inputElement.value.trim().toLowerCase();

    // Filter recent URLs based on query
    let suggestions: string[];
    if (query) {
      suggestions = this.recentURLs.filter(url =>
        url.toLowerCase().includes(query)
      );
    } else {
      // Show all recent URLs (reversed, most recent first)
      suggestions = [...this.recentURLs].reverse().slice(0, 10);
    }

    // Remove duplicates and current path
    const currentPath = this.router.getCurrentPath();
    suggestions = [...new Set(suggestions)].filter(url => url !== currentPath);

    // Render suggestions
    if (suggestions.length === 0) {
      this.suggestionsElement.innerHTML = '<div class="search-spotlight__empty">No recent URLs</div>';
      return;
    }

    this.suggestionsElement.innerHTML = suggestions
      .map((url, index) => `
        <div class="search-spotlight__suggestion ${index === this.selectedSuggestionIndex ? 'search-spotlight__suggestion--selected' : ''}" data-url="${url}" data-index="${index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-spotlight__suggestion-icon">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="search-spotlight__suggestion-text">${url}</span>
        </div>
      `)
      .join('');

    // Add click handlers to suggestions
    this.suggestionsElement.querySelectorAll('.search-spotlight__suggestion').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.getAttribute('data-url');
        if (url) {
          this.router.navigate(url);
          this.close();
        }
      });
    });
  }

  private selectNextSuggestion(): void {
    const focusableElements = this.getFocusableElements();
    if (focusableElements.length === 0) return;

    this.selectedSuggestionIndex = Math.min(this.selectedSuggestionIndex + 1, focusableElements.length - 1);
    this.updateSelectedSuggestion();
  }

  private selectPreviousSuggestion(): void {
    const focusableElements = this.getFocusableElements();
    if (focusableElements.length === 0) return;

    this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
    this.updateSelectedSuggestion();
  }

  private getFocusableElements(): Element[] {
    const elements: Element[] = [];

    // Add Back/Forward buttons
    const backBtn = this.element.querySelector('.search-spotlight__btn--back:not(:disabled)');
    const forwardBtn = this.element.querySelector('.search-spotlight__btn--forward:not(:disabled)');

    if (backBtn) elements.push(backBtn);
    if (forwardBtn) elements.push(forwardBtn);

    // Add suggestions
    if (this.suggestionsElement) {
      const suggestions = this.suggestionsElement.querySelectorAll('.search-spotlight__suggestion');
      elements.push(...Array.from(suggestions));
    }

    return elements;
  }

  private updateSelectedSuggestion(): void {
    const focusableElements = this.getFocusableElements();

    focusableElements.forEach((item, index) => {
      if (index === this.selectedSuggestionIndex) {
        item.classList.add('search-spotlight__suggestion--selected');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('search-spotlight__suggestion--selected');
      }
    });
  }

  private navigateToSelectedOrInput(): void {
    // If an element is selected, trigger its action
    if (this.selectedSuggestionIndex >= 0) {
      const focusableElements = this.getFocusableElements();
      const selectedElement = focusableElements[this.selectedSuggestionIndex];

      if (selectedElement) {
        // Check if it's a button (Back/Forward)
        if (selectedElement instanceof HTMLButtonElement) {
          selectedElement.click();
          this.updateNavigationButtons();
          return;
        }

        // Check if it's a suggestion
        const url = selectedElement.getAttribute('data-url');
        if (url) {
          this.router.navigate(url);
          this.close();
          return;
        }
      }
    }

    // Otherwise, navigate to input value
    this.navigateToInputURL();
  }

  public destroy(): void {
    this.element.remove();
  }
}
