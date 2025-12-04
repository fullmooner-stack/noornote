/**
 * NewBookmarkModal
 * Modal to create a new URL bookmark with optional folder assignment
 */

import { ModalService } from '../../services/ModalService';
import { BookmarkFolderService } from '../../services/BookmarkFolderService';

export interface NewBookmarkModalOptions {
  onConfirm: (url: string, description: string, folderId: string, newFolderName?: string) => void;
}

export class NewBookmarkModal {
  private modalService: ModalService;
  private folderService: BookmarkFolderService;
  private options: NewBookmarkModalOptions;

  constructor(options: NewBookmarkModalOptions) {
    this.modalService = ModalService.getInstance();
    this.folderService = BookmarkFolderService.getInstance();
    this.options = options;
  }

  public show(): void {
    const content = this.renderContent();

    this.modalService.show({
      title: 'New Bookmark',
      content,
      width: '450px',
      showCloseButton: true,
      closeOnOverlay: true,
      closeOnEsc: true
    });

    setTimeout(() => {
      this.setupEventHandlers();
      const input = document.getElementById('new-bookmark-url-input') as HTMLInputElement;
      input?.focus();
    }, 0);
  }

  private renderContent(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'new-bookmark-modal';

    const folders = this.folderService.getFolders();

    container.innerHTML = `
      <div class="new-bookmark-modal__content">
        <div class="form-group">
          <label for="new-bookmark-url-input">URL</label>
          <input
            type="url"
            id="new-bookmark-url-input"
            class="input"
            placeholder="https://..."
            autocomplete="off"
          />
        </div>

        <div class="form-group">
          <label for="new-bookmark-description-input">Description</label>
          <input
            type="text"
            id="new-bookmark-description-input"
            class="input"
            placeholder="Optional description..."
            maxlength="200"
            autocomplete="off"
          />
        </div>

        <div class="form-group">
          <label for="new-bookmark-folder-select">Save to</label>
          <select id="new-bookmark-folder-select" class="input">
            <option value="">Root Level</option>
            ${folders.map(f => `<option value="${f.id}">${this.escapeHtml(f.name)}</option>`).join('')}
            <option value="__new__">+ Create new folder...</option>
          </select>
        </div>

        <div class="form-group new-bookmark-modal__new-folder-group" style="display: none;">
          <label for="new-bookmark-folder-name-input">New folder name</label>
          <input
            type="text"
            id="new-bookmark-folder-name-input"
            class="input"
            placeholder="Enter folder name..."
            maxlength="50"
            autocomplete="off"
          />
        </div>

        <div class="new-bookmark-modal__actions">
          <button type="button" class="btn btn--passive" id="new-bookmark-cancel-btn">
            Cancel
          </button>
          <button type="button" class="btn" id="new-bookmark-save-btn">
            Save
          </button>
        </div>
      </div>
    `;

    return container;
  }

  private setupEventHandlers(): void {
    const urlInput = document.getElementById('new-bookmark-url-input') as HTMLInputElement;
    const descriptionInput = document.getElementById('new-bookmark-description-input') as HTMLInputElement;
    const folderSelect = document.getElementById('new-bookmark-folder-select') as HTMLSelectElement;
    const newFolderGroup = document.querySelector('.new-bookmark-modal__new-folder-group') as HTMLElement;
    const newFolderInput = document.getElementById('new-bookmark-folder-name-input') as HTMLInputElement;
    const cancelBtn = document.getElementById('new-bookmark-cancel-btn');
    const saveBtn = document.getElementById('new-bookmark-save-btn');

    if (!urlInput || !folderSelect || !cancelBtn || !saveBtn) return;

    // Show/hide new folder input based on selection
    folderSelect.addEventListener('change', () => {
      if (folderSelect.value === '__new__') {
        newFolderGroup.style.display = 'block';
        newFolderInput?.focus();
      } else {
        newFolderGroup.style.display = 'none';
      }
    });

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

      const folderId = folderSelect.value;
      const newFolderName = folderId === '__new__' ? newFolderInput?.value.trim() : undefined;

      if (folderId === '__new__' && !newFolderName) {
        newFolderInput?.focus();
        return;
      }

      this.modalService.hide();
      this.options.onConfirm(url, description, folderId, newFolderName);
    };

    // Cancel
    cancelBtn.addEventListener('click', () => {
      this.modalService.hide();
    });

    // Save
    saveBtn.addEventListener('click', handleSave);

    // Enter key on URL input
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        this.modalService.hide();
      }
    });

    // Enter key on new folder input
    newFolderInput?.addEventListener('keydown', (e) => {
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
