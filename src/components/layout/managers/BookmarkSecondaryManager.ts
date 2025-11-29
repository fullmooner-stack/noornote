/**
 * BookmarkSecondaryManager
 * Manages bookmark grid view with folders and drag & drop support
 *
 * Features:
 * - Grid layout with cards (3 columns)
 * - Folder support (bookmark categories)
 * - Drag & Drop for reordering and folder assignment
 * - Navigation between root and folder views
 *
 * @purpose Handle bookmark grid rendering, folders, drag & drop, sync operations
 * @used-by MainLayout
 */

import { EventBus } from '../../../services/EventBus';
import { AuthService } from '../../../services/AuthService';
import { ToastService } from '../../../services/ToastService';
import { BookmarkOrchestrator } from '../../../services/orchestration/BookmarkOrchestrator';
import { BookmarkFolderService } from '../../../services/BookmarkFolderService';
import { UserProfileService } from '../../../services/UserProfileService';
import { NostrTransport } from '../../../services/transport/NostrTransport';
import { RelayConfig } from '../../../services/RelayConfig';
import { ListSyncManager } from '../../../services/sync/ListSyncManager';
import { BookmarkStorageAdapter } from '../../../services/sync/adapters/BookmarkStorageAdapter';
import { SyncConfirmationModal } from '../../modals/SyncConfirmationModal';
import { NewFolderModal } from '../../modals/NewFolderModal';
import { BookmarkCard, type BookmarkCardData } from '../../bookmarks/BookmarkCard';
import { FolderCard, type FolderData } from '../../bookmarks/FolderCard';
import { UpNavigator } from '../../bookmarks/UpNavigator';
import type { BookmarkItem } from '../../../services/storage/BookmarkFileStorage';
import type { NostrEvent } from '@nostr-dev-kit/ndk';

interface BookmarkWithEvent extends BookmarkItem {
  event?: NostrEvent;
  isPrivate: boolean;
}

export class BookmarkSecondaryManager {
  private containerElement: HTMLElement;
  private eventBus: EventBus;
  private authService: AuthService;
  private bookmarkOrch: BookmarkOrchestrator;
  private folderService: BookmarkFolderService;
  private userProfileService: UserProfileService;
  private transport: NostrTransport;
  private relayConfig: RelayConfig;
  private listSyncManager: ListSyncManager<BookmarkItem>;
  private adapter: BookmarkStorageAdapter;

  // View state
  private currentFolderId: string = ''; // '' = root
  private bookmarksCache: Map<string, BookmarkWithEvent> = new Map();
  private isLoading: boolean = false;

  // Drag state
  private draggedItemId: string | null = null;
  private draggedItemType: 'bookmark' | 'folder' | null = null;

  constructor(containerElement: HTMLElement) {
    this.containerElement = containerElement;
    this.eventBus = EventBus.getInstance();
    this.authService = AuthService.getInstance();
    this.bookmarkOrch = BookmarkOrchestrator.getInstance();
    this.folderService = BookmarkFolderService.getInstance();
    this.userProfileService = UserProfileService.getInstance();
    this.transport = NostrTransport.getInstance();
    this.relayConfig = RelayConfig.getInstance();

    this.adapter = new BookmarkStorageAdapter();
    this.listSyncManager = new ListSyncManager(this.adapter);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('bookmark:updated', () => {
      this.refreshIfActive();
    });

    this.eventBus.on('user:logout', () => {
      this.currentFolderId = '';
      this.bookmarksCache.clear();
    });
  }

  private refreshIfActive(): void {
    const listTab = this.containerElement.querySelector('[data-tab-content="list-bookmarks"]');
    if (listTab && listTab.classList.contains('tab-content--active')) {
      this.renderBookmarksTab(listTab as HTMLElement);
    }
  }

  /**
   * Handle tab switch (called by MainLayout)
   */
  public handleTabSwitch(tabName: string, content: HTMLElement): void {
    if (tabName === 'bookmarks') {
      this.renderBookmarksTab(content);
    }
  }

  /**
   * Public render method (called by MainLayout)
   */
  public async renderListTab(container: HTMLElement): Promise<void> {
    await this.renderBookmarksTab(container);
  }

  /**
   * Main render function
   */
  private async renderBookmarksTab(container: HTMLElement): Promise<void> {
    const currentUser = this.authService.getCurrentUser();

    if (!currentUser) {
      container.innerHTML = `
        <div class="bookmarks-empty-state">
          <p>Log in to see your bookmarks</p>
        </div>
      `;
      return;
    }

    // Show loading
    container.innerHTML = `
      <div class="bookmarks-loading">Loading bookmarks...</div>
    `;

    try {
      // Fetch all bookmarks from browser storage
      await this.loadBookmarks();

      // Render the view
      await this.renderCurrentView(container);
    } catch (error) {
      console.error('Failed to render bookmarks:', error);
      container.innerHTML = `
        <div class="bookmarks-empty-state">
          <p>Failed to load bookmarks</p>
        </div>
      `;
    }
  }

  /**
   * Load all bookmarks and their events
   */
  private async loadBookmarks(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const bookmarksFromBrowser = this.adapter.getBrowserItems();

      if (bookmarksFromBrowser.length === 0) {
        this.bookmarksCache.clear();
        return;
      }

      // Sort bookmarks by addedAt DESC (newest first) for initial display
      const sortedBookmarks = [...bookmarksFromBrowser].sort((a, b) => {
        const timeA = a.addedAt || 0;
        const timeB = b.addedAt || 0;
        return timeB - timeA; // DESC - newest first
      });

      // Fetch events from relays
      const relays = this.relayConfig.getAllRelays().map(r => r.url);
      const events = await this.transport.fetch(relays, [{
        ids: sortedBookmarks.map(b => b.id)
      }], 5000);

      // Build cache
      const eventMap = new Map<string, NostrEvent>();
      events.forEach(e => eventMap.set(e.id, e));

      this.bookmarksCache.clear();

      // Check if this is first initialization (no root order yet)
      const isFirstInit = !this.folderService.hasRootOrder();

      // Process in sorted order (newest first)
      for (const bookmark of sortedBookmarks) {
        const event = eventMap.get(bookmark.id);
        this.bookmarksCache.set(bookmark.id, {
          ...bookmark,
          event,
          isPrivate: (bookmark as BookmarkItem & { isPrivate?: boolean }).isPrivate || false
        });

        // Ensure folder assignment exists
        this.folderService.ensureBookmarkAssignment(bookmark.id);
      }

      // On first init, build root order from sorted bookmarks (newest first)
      if (isFirstInit) {
        const rootOrder: Array<{ type: 'folder' | 'bookmark'; id: string }> = [];
        for (const bookmark of sortedBookmarks) {
          rootOrder.push({ type: 'bookmark', id: bookmark.id });
        }
        this.folderService.saveRootOrder(rootOrder);
      }
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Render current view (root or folder)
   */
  private async renderCurrentView(container: HTMLElement): Promise<void> {
    const isInFolder = this.currentFolderId !== '';
    const folder = isInFolder ? this.folderService.getFolder(this.currentFolderId) : null;

    // Build HTML structure
    container.innerHTML = `
      ${this.renderSyncControls()}
      ${this.renderHeader(folder)}
      ${isInFolder ? this.renderBreadcrumb(folder) : ''}
      <div class="bookmark-grid"></div>
      ${this.renderSyncControls()}
    `;

    // Bind sync buttons
    this.bindSyncButtons(container);

    // Bind header buttons
    this.bindHeaderButtons(container);

    // Render grid content
    const grid = container.querySelector('.bookmark-grid') as HTMLElement;
    await this.renderGridContent(grid);
  }

  /**
   * Render sync controls
   */
  private renderSyncControls(): string {
    return `
      <div class="list-sync-controls">
        <button class="btn btn--mini btn--passive sync-from-relays-btn">
          Sync from Relays
        </button>
        <button class="btn btn--mini btn--passive sync-to-relays-btn">
          Sync to Relays
        </button>
        <button class="btn btn--mini btn--passive save-to-file-btn">
          Save to File
        </button>
        <button class="btn btn--mini btn--passive restore-from-file-btn">
          Restore from File
        </button>
      </div>
      <p class="list-sync-info">
        This list is stored in 3 places: on your hard drive - in the NoorNote app - on the relays.
      </p>
    `;
  }

  /**
   * Render header with New Folder button
   */
  private renderHeader(folder: { id: string; name: string } | null): string {
    const title = folder ? folder.name : 'Bookmarks';

    return `
      <div class="bookmark-header">
        <span class="bookmark-header__title">${this.escapeHtml(title)}</span>
        <button class="bookmark-header__new-folder-btn" title="Create new folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          New Folder
        </button>
      </div>
    `;
  }

  /**
   * Render breadcrumb navigation
   */
  private renderBreadcrumb(folder: { id: string; name: string } | null): string {
    if (!folder) return '';

    return `
      <div class="bookmark-breadcrumb">
        <span class="bookmark-breadcrumb__item" data-navigate="root">Bookmarks</span>
        <span class="bookmark-breadcrumb__separator">/</span>
        <span class="bookmark-breadcrumb__item bookmark-breadcrumb__item--current">${this.escapeHtml(folder.name)}</span>
      </div>
    `;
  }

  /**
   * Render grid content (cards)
   */
  private async renderGridContent(grid: HTMLElement): Promise<void> {
    grid.innerHTML = '';

    if (this.currentFolderId !== '') {
      // In a folder - show up navigator first
      const upNav = new UpNavigator({
        onClick: () => this.navigateToRoot(),
        onDrop: async (bookmarkId) => {
          await this.moveBookmarkToFolder(bookmarkId, '');
        }
      });
      grid.appendChild(upNav.render());

      // Get bookmarks in this folder
      const bookmarkIds = this.folderService.getBookmarksInFolder(this.currentFolderId);
      for (const bookmarkId of bookmarkIds) {
        const bookmark = this.bookmarksCache.get(bookmarkId);
        if (bookmark) {
          const card = await this.createBookmarkCard(bookmark);
          grid.appendChild(card);
        }
      }
    } else {
      // Root view - mixed folders and bookmarks
      const rootOrder = this.folderService.getRootOrder();
      const renderedIds = new Set<string>();

      for (const item of rootOrder) {
        if (item.type === 'folder') {
          const folder = this.folderService.getFolder(item.id);
          if (folder) {
            const card = this.createFolderCard(folder);
            grid.appendChild(card);
            renderedIds.add(item.id);
          }
        } else if (item.type === 'bookmark') {
          const bookmark = this.bookmarksCache.get(item.id);
          // Only show if in root (no folder assignment)
          const folderId = this.folderService.getBookmarkFolder(item.id);
          if (bookmark && folderId === '') {
            const card = await this.createBookmarkCard(bookmark);
            grid.appendChild(card);
            renderedIds.add(item.id);
          }
        }
      }

      // Add any new items not in root order yet
      const folders = this.folderService.getFolders();
      for (const folder of folders) {
        if (!renderedIds.has(folder.id)) {
          const card = this.createFolderCard(folder);
          grid.appendChild(card);
          this.folderService.addToRootOrder('folder', folder.id);
        }
      }

      for (const [bookmarkId, bookmark] of this.bookmarksCache) {
        const folderId = this.folderService.getBookmarkFolder(bookmarkId);
        if (folderId === '' && !renderedIds.has(bookmarkId)) {
          const card = await this.createBookmarkCard(bookmark);
          grid.appendChild(card);
          this.folderService.addToRootOrder('bookmark', bookmarkId);
        }
      }
    }

    // Check empty state
    if (grid.children.length === 0 || (this.currentFolderId === '' && grid.children.length === 0)) {
      grid.innerHTML = `
        <div class="bookmarks-empty-state" style="grid-column: 1 / -1;">
          <p>No bookmarks yet</p>
        </div>
      `;
    }

    // Setup drag & drop for reordering
    this.setupGridDragDrop(grid);
  }

  /**
   * Create a bookmark card
   */
  private async createBookmarkCard(bookmark: BookmarkWithEvent): Promise<HTMLElement> {
    const cardData: BookmarkCardData = {
      id: bookmark.id,
      event: bookmark.event,
      isPrivate: bookmark.isPrivate,
      folderId: this.folderService.getBookmarkFolder(bookmark.id)
    };

    const card = new BookmarkCard(cardData, {
      onDelete: async (eventId) => {
        await this.deleteBookmark(eventId);
      },
      onDragStart: (eventId) => {
        this.draggedItemId = eventId;
        this.draggedItemType = 'bookmark';
      },
      onDragEnd: () => {
        this.draggedItemId = null;
        this.draggedItemType = null;
      }
    });

    return await card.render();
  }

  /**
   * Create a folder card
   */
  private createFolderCard(folder: { id: string; name: string }): HTMLElement {
    const folderData: FolderData = {
      id: folder.id,
      name: folder.name,
      itemCount: this.folderService.getFolderItemCount(folder.id)
    };

    const card = new FolderCard(folderData, {
      onClick: (folderId) => this.navigateToFolder(folderId),
      onDelete: async (folderId) => {
        await this.deleteFolder(folderId);
      },
      onDrop: async (bookmarkId, folderId) => {
        await this.moveBookmarkToFolder(bookmarkId, folderId);
      },
      onDragStart: (folderId) => {
        this.draggedItemId = folderId;
        this.draggedItemType = 'folder';
      },
      onDragEnd: () => {
        this.draggedItemId = null;
        this.draggedItemType = null;
      }
    });

    return card.render();
  }

  /**
   * Setup mouse-based drag & drop for grid reordering
   */
  private setupGridDragDrop(grid: HTMLElement): void {
    let draggedCard: HTMLElement | null = null;
    let draggedId: string | null = null;
    let placeholder: HTMLElement | null = null;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't drag if clicking delete button
      if (target.closest('.bookmark-card__delete') || target.closest('.folder-card__delete')) {
        return;
      }

      const card = target.closest('.bookmark-card, .folder-card') as HTMLElement;
      if (!card || card.classList.contains('up-navigator')) return;

      e.preventDefault();
      draggedCard = card;
      draggedId = card.dataset.bookmarkId || card.dataset.folderId || null;
      startX = e.clientX;
      startY = e.clientY;

      const rect = card.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!draggedCard) return;

      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);

      // Start dragging after moving 5px
      if (!isDragging && (dx > 5 || dy > 5)) {
        isDragging = true;
        draggedCard.dataset.wasDragging = 'true';
        draggedCard.classList.add('dragging');

        // Create placeholder
        placeholder = document.createElement('div');
        placeholder.className = 'bookmark-card-placeholder';
        placeholder.style.width = draggedCard.offsetWidth + 'px';
        placeholder.style.height = draggedCard.offsetHeight + 'px';
        draggedCard.parentNode?.insertBefore(placeholder, draggedCard);

        // Make card follow mouse
        draggedCard.style.position = 'fixed';
        draggedCard.style.zIndex = '1000';
        draggedCard.style.width = draggedCard.offsetWidth + 'px';
        draggedCard.style.pointerEvents = 'none';
      }

      if (isDragging) {
        draggedCard.style.left = (e.clientX - offsetX) + 'px';
        draggedCard.style.top = (e.clientY - offsetY) + 'px';

        // Find card under cursor
        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        const cardBelow = elemBelow?.closest('.bookmark-card:not(.dragging), .folder-card:not(.dragging), .up-navigator') as HTMLElement;

        // Remove previous highlights
        grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));

        if (cardBelow && cardBelow !== placeholder) {
          cardBelow.classList.add('drag-over');
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (!draggedCard || !isDragging) {
        draggedCard = null;
        isDragging = false;
        return;
      }

      // Find drop target BEFORE restoring pointer events
      // Hide dragged card temporarily to find element below
      const savedDisplay = draggedCard.style.display;
      draggedCard.style.display = 'none';
      const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
      draggedCard.style.display = savedDisplay;
      const dropTarget = elemBelow?.closest('.bookmark-card, .folder-card, .up-navigator') as HTMLElement;

      // Reset dragged card style
      draggedCard.classList.remove('dragging');
      draggedCard.style.position = '';
      draggedCard.style.zIndex = '';
      draggedCard.style.width = '';
      draggedCard.style.left = '';
      draggedCard.style.top = '';
      draggedCard.style.pointerEvents = '';

      // Remove highlights
      grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));

      // Remove placeholder
      placeholder?.remove();
      placeholder = null;

      if (dropTarget && draggedId && draggedCard) {
        const targetId = dropTarget.dataset.bookmarkId || dropTarget.dataset.folderId;
        const isDraggingBookmark = draggedCard.classList.contains('bookmark-card');
        const isDraggingFolder = draggedCard.classList.contains('folder-card');
        const isTargetFolder = dropTarget.classList.contains('folder-card');
        const isTargetUpNav = dropTarget.classList.contains('up-navigator');

        if (isTargetUpNav && isDraggingBookmark) {
          // Move bookmark to root (from folder)
          this.moveBookmarkToFolder(draggedId, '');
        } else if (isTargetFolder && isDraggingBookmark && targetId) {
          // Move bookmark into folder
          this.moveBookmarkToFolder(draggedId, targetId);
        } else if (targetId && targetId !== draggedId) {
          // Reorder - just move DOM element, no re-render
          const draggedType = isDraggingFolder ? 'folder' : 'bookmark';
          const rootOrder = this.folderService.getRootOrder();
          const targetIndex = rootOrder.findIndex(item => item.id === targetId);
          if (targetIndex !== -1) {
            this.folderService.moveInRootOrder(draggedType as 'folder' | 'bookmark', draggedId, targetIndex);
            // Move DOM element directly
            grid.insertBefore(draggedCard, dropTarget);
          }
        }
      }

      draggedCard = null;
      draggedId = null;
      isDragging = false;
    };

    grid.addEventListener('mousedown', onMouseDown);
  }

  // ========================================
  // Navigation
  // ========================================

  private navigateToFolder(folderId: string): void {
    this.currentFolderId = folderId;
    const container = this.containerElement.querySelector('[data-tab-content="list-bookmarks"]');
    if (container) {
      this.renderCurrentView(container as HTMLElement);
    }
  }

  private navigateToRoot(): void {
    this.currentFolderId = '';
    const container = this.containerElement.querySelector('[data-tab-content="list-bookmarks"]');
    if (container) {
      this.renderCurrentView(container as HTMLElement);
    }
  }

  // ========================================
  // Actions
  // ========================================

  private async deleteBookmark(eventId: string): Promise<void> {
    const isPrivate = this.bookmarkOrch.isPrivateBookmarksEnabled();

    try {
      // Remove from files
      await this.bookmarkOrch.removeBookmark(eventId, isPrivate);

      // Remove from browser storage
      const currentItems = this.adapter.getBrowserItems();
      const updatedItems = currentItems.filter(b => b.id !== eventId);
      this.adapter.setBrowserItems(updatedItems);

      // Remove folder assignment
      this.folderService.removeBookmarkAssignment(eventId);
      this.folderService.removeFromRootOrder('bookmark', eventId);

      // Remove from cache
      this.bookmarksCache.delete(eventId);

      ToastService.show('Bookmark removed', 'success');
      // Note: Card is already removed from DOM by BookmarkCard.ts via card.remove()
      // Don't emit bookmark:updated to avoid full re-render
    } catch (error) {
      console.error('Failed to delete bookmark:', error);
      ToastService.show('Failed to remove bookmark', 'error');
    }
  }

  private async deleteFolder(folderId: string): Promise<void> {
    try {
      // Delete folder (moves items to root)
      const affectedIds = this.folderService.deleteFolder(folderId);

      // Remove from root order
      this.folderService.removeFromRootOrder('folder', folderId);

      // Add affected bookmarks back to root order
      affectedIds.forEach(id => {
        this.folderService.addToRootOrder('bookmark', id);
      });

      ToastService.show('Folder deleted, bookmarks moved to root', 'success');

      // Refresh view
      const container = this.containerElement.querySelector('[data-tab-content="list-bookmarks"]');
      if (container) {
        this.renderCurrentView(container as HTMLElement);
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      ToastService.show('Failed to delete folder', 'error');
    }
  }

  private async moveBookmarkToFolder(bookmarkId: string, targetFolderId: string): Promise<void> {
    try {
      const currentFolderId = this.folderService.getBookmarkFolder(bookmarkId);

      // Don't move if already in target folder
      if (currentFolderId === targetFolderId) return;

      // Update assignment
      this.folderService.moveBookmarkToFolder(bookmarkId, targetFolderId);

      // Update root order
      if (currentFolderId === '' && targetFolderId !== '') {
        // Moving from root to folder - remove from root order
        this.folderService.removeFromRootOrder('bookmark', bookmarkId);
      } else if (currentFolderId !== '' && targetFolderId === '') {
        // Moving from folder to root - add to root order
        this.folderService.addToRootOrder('bookmark', bookmarkId);
      }

      const targetName = targetFolderId === ''
        ? 'root'
        : this.folderService.getFolder(targetFolderId)?.name || 'folder';

      ToastService.show(`Moved to ${targetName}`, 'success');

      // Just remove the card from DOM - it's now in a different folder/root
      const card = this.containerElement.querySelector(`[data-bookmark-id="${bookmarkId}"]`);
      card?.remove();

      // Update folder item count if moving into a folder
      if (targetFolderId !== '') {
        const folderCard = this.containerElement.querySelector(`[data-folder-id="${targetFolderId}"]`);
        const countEl = folderCard?.querySelector('.folder-card__count');
        if (countEl) {
          const newCount = this.folderService.getFolderItemCount(targetFolderId);
          countEl.textContent = `${newCount} ${newCount === 1 ? 'item' : 'items'}`;
        }
      }
    } catch (error) {
      console.error('Failed to move bookmark:', error);
      ToastService.show('Failed to move bookmark', 'error');
    }
  }

  private createNewFolder(): void {
    const modal = new NewFolderModal({
      onConfirm: (name) => {
        try {
          const folder = this.folderService.createFolder(name);
          this.folderService.addToRootOrder('folder', folder.id);

          // Add folder card to grid at the beginning without full re-render
          const grid = this.containerElement.querySelector('.bookmark-grid');
          if (grid) {
            const card = this.createFolderCard(folder);
            grid.insertBefore(card, grid.firstChild);
          }

          ToastService.show(`Folder "${name}" created`, 'success');
        } catch (error) {
          console.error('Failed to create folder:', error);
          ToastService.show('Failed to create folder', 'error');
        }
      }
    });

    modal.show();
  }

  // ========================================
  // Sync Handlers
  // ========================================

  private bindSyncButtons(container: HTMLElement): void {
    container.querySelectorAll('.sync-from-relays-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleSyncFromRelays(container));
    });

    container.querySelectorAll('.sync-to-relays-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleSyncToRelays());
    });

    container.querySelectorAll('.save-to-file-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleSaveToFile());
    });

    container.querySelectorAll('.restore-from-file-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleRestoreFromFile(container));
    });
  }

  private bindHeaderButtons(container: HTMLElement): void {
    const newFolderBtn = container.querySelector('.bookmark-header__new-folder-btn');
    newFolderBtn?.addEventListener('click', () => this.createNewFolder());

    // Breadcrumb navigation
    const rootLink = container.querySelector('[data-navigate="root"]');
    rootLink?.addEventListener('click', () => this.navigateToRoot());
  }

  private async handleSyncFromRelays(container: HTMLElement): Promise<void> {
    try {
      ToastService.show('Fetching from relays...', 'info');

      const result = await this.listSyncManager.syncFromRelays();

      if (result.requiresConfirmation) {
        const modal = new SyncConfirmationModal({
          listType: 'Bookmarks',
          added: result.diff.added,
          removed: result.diff.removed,
          getDisplayName: (item) => this.getDisplayNameForSync(item),
          onKeep: async () => {
            await this.listSyncManager.applySyncFromRelays('merge', result.relayItems, result.relayContentWasEmpty);
            ToastService.show(`Merged bookmarks from relays`, 'success');
            await this.loadBookmarks();
            this.renderCurrentView(container);
          },
          onDelete: async () => {
            await this.listSyncManager.applySyncFromRelays('overwrite', result.relayItems, result.relayContentWasEmpty);
            ToastService.show('Synced from relays', 'success');
            await this.loadBookmarks();
            this.renderCurrentView(container);
          }
        });

        await modal.show();
      } else {
        await this.listSyncManager.applySyncFromRelays('merge', result.relayItems, result.relayContentWasEmpty);
        ToastService.show(`Synced from relays`, 'success');
        await this.loadBookmarks();
        this.renderCurrentView(container);
      }
    } catch (error) {
      console.error('Failed to sync from relays:', error);
      ToastService.show('Failed to sync from relays', 'error');
    }
  }

  private async handleSyncToRelays(): Promise<void> {
    try {
      ToastService.show('Publishing to relays...', 'info');
      await this.listSyncManager.syncToRelays();
      ToastService.show('Bookmarks published successfully', 'success');
    } catch (error) {
      console.error('Failed to publish to relays:', error);
      ToastService.show('Failed to publish to relays', 'error');
    }
  }

  private async handleSaveToFile(): Promise<void> {
    try {
      ToastService.show('Saving to file...', 'info');
      await this.listSyncManager.saveToFile();
      ToastService.show('Saved to local file', 'success');
    } catch (error) {
      console.error('Failed to save to file:', error);
      ToastService.show('Failed to save to file', 'error');
    }
  }

  private async handleRestoreFromFile(container: HTMLElement): Promise<void> {
    try {
      ToastService.show('Restoring from file...', 'info');

      // Restore folder data first (before items)
      await this.adapter.restoreFolderDataFromFile();

      // Then restore bookmark items
      await this.listSyncManager.restoreFromFile();

      ToastService.show('Restored from local file', 'success');
      await this.loadBookmarks();
      this.renderCurrentView(container);
    } catch (error) {
      console.error('Failed to restore from file:', error);
      ToastService.show('Failed to restore from file', 'error');
    }
  }

  private async getDisplayNameForSync(item: BookmarkItem): Promise<string> {
    try {
      const relays = this.relayConfig.getAllRelays().map(r => r.url);
      const events = await this.transport.fetch(relays, [{ ids: [item.id] }], 3000);

      if (events.length === 0) {
        return item.id.slice(0, 12) + '...';
      }

      const event = events[0];
      const snippet = event.content.slice(0, 60);
      return snippet || item.id.slice(0, 12) + '...';
    } catch {
      return item.id.slice(0, 12) + '...';
    }
  }

  // ========================================
  // Helpers
  // ========================================

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  public destroy(): void {
    // Cleanup if needed
  }
}
