/**
 * EditBookmarkModal
 * Modal to edit an existing URL bookmark
 */

import { ModalService } from '../../services/ModalService';

export interface EditBookmarkModalOptions {
  url: string;
  description: string;
  onSave: (url: string, description: string) => void;
}

export class EditBookmarkModal {
  private modalService: ModalService;
  private options: EditBookmarkModalOptions;

  constructor(options: EditBookmarkModalOptions) {
    this.modalService = ModalService.getInstance();
    this.options = options;
  }

  public show(): void {
    const content = this.renderContent();

    this.modalService.show({
      title: 'Edit Bookmark',
      content,
      width: '450px',
      showCloseButton: true,
      closeOnOverlay: true,
      closeOnEsc: true
    });

    setTimeout(() => {
      this.setupEventHandlers();
      const input = document.getElementById('edit-bookmark-url-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  private renderContent(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'edit-bookmark-modal';

    container.innerHTML = `
      <div class="edit-bookmark-modal__content">
        <div class="form-group">
          <label for="edit-bookmark-url-input">URL</label>
          <input
            type="url"
            id="edit-bookmark-url-input"
            class="input"
            placeholder="https://..."
            value="${this.escapeHtml(this.options.url)}"
            autocomplete="off"
          />
        </div>

        <div class="form-group">
          <label for="edit-bookmark-description-input">Description</label>
          <input
            type="text"
            id="edit-bookmark-description-input"
            class="input"
            placeholder="Optional description..."
            value="${this.escapeHtml(this.options.description)}"
            maxlength="200"
            autocomplete="off"
          />
        </div>

        <div class="edit-bookmark-modal__actions">
          <button type="button" class="btn btn--passive" id="edit-bookmark-cancel-btn">
            Cancel
          </button>
          <button type="button" class="btn" id="edit-bookmark-save-btn">
            Save
          </button>
        </div>
      </div>
    `;

    return container;
  }

  private setupEventHandlers(): void {
    const urlInput = document.getElementById('edit-bookmark-url-input') as HTMLInputElement;
    const descriptionInput = document.getElementById('edit-bookmark-description-input') as HTMLInputElement;
    const cancelBtn = document.getElementById('edit-bookmark-cancel-btn');
    const saveBtn = document.getElementById('edit-bookmark-save-btn');

    if (!urlInput || !cancelBtn || !saveBtn) return;

    const handleSave = () => {
      const url = urlInput.value.trim();
      const description = descriptionInput?.value.trim() || '';

      if (!url) {
        urlInput.focus();
        return;
      }

      // Validate URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        urlInput.setCustomValidity('Please enter a valid URL starting with http:// or https://');
        urlInput.reportValidity();
        return;
      }

      this.modalService.hide();
      this.options.onSave(url, description);
    };

    // Cancel
    cancelBtn.addEventListener('click', () => {
      this.modalService.hide();
    });

    // Save
    saveBtn.addEventListener('click', handleSave);

    // Enter key
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        this.modalService.hide();
      }
    });

    descriptionInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        this.modalService.hide();
      }
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
