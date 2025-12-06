/**
 * DMStore - IndexedDB Storage for NIP-17 Direct Messages
 * Stores unwrapped rumors (kind:14) and conversation metadata
 *
 * @service DMStore
 * @purpose Persistent storage for DM conversations and messages
 * @used-by DMService
 */

import { SystemLogger } from '../../components/system/SystemLogger';

export type DMFormat = 'nip17' | 'legacy';

export interface DMMessage {
  /** Event ID of the rumor (kind:14) */
  id: string;
  /** Sender pubkey (hex) */
  pubkey: string;
  /** Message content */
  content: string;
  /** Real timestamp (from rumor, not gift wrap) */
  createdAt: number;
  /** Conversation partner pubkey (hex) - for indexing */
  conversationWith: string;
  /** Reply-to event ID (from e-tag with 'reply' marker) */
  replyTo?: string;
  /** Subject/title of conversation (from 'subject' tag) */
  subject?: string;
  /** Whether this message was sent by current user */
  isMine: boolean;
  /** Gift wrap event ID (for deduplication) */
  wrapId: string;
  /** Message format: 'nip17' (secure) or 'legacy' (NIP-04) */
  format: DMFormat;
}

export interface DMConversation {
  /** Partner pubkey (hex) - primary key */
  pubkey: string;
  /** Last message timestamp */
  lastMessageAt: number;
  /** Last message preview (truncated) */
  lastMessagePreview: string;
  /** Unread message count */
  unreadCount: number;
  /** Conversation subject (latest) */
  subject?: string;
}

const DB_NAME = 'noornote_dm';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';
const CONVERSATIONS_STORE = 'conversations';

export class DMStore {
  private static instance: DMStore;
  private db: IDBDatabase | null = null;
  private systemLogger: SystemLogger;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    this.systemLogger = SystemLogger.getInstance();
  }

  public static getInstance(): DMStore {
    if (!DMStore.instance) {
      DMStore.instance = new DMStore();
    }
    return DMStore.instance;
  }

  /**
   * Initialize IndexedDB (lazy, called on first access)
   */
  public async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        this.systemLogger.error('DMStore', 'Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.systemLogger.info('DMStore', 'IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Messages store with indexes
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const messagesStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
          messagesStore.createIndex('conversationWith', 'conversationWith', { unique: false });
          messagesStore.createIndex('createdAt', 'createdAt', { unique: false });
          messagesStore.createIndex('wrapId', 'wrapId', { unique: true });
        }

        // Conversations store
        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          const conversationsStore = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'pubkey' });
          conversationsStore.createIndex('lastMessageAt', 'lastMessageAt', { unique: false });
        }

        this.systemLogger.info('DMStore', 'IndexedDB schema created/upgraded');
      };
    });

    return this.initPromise;
  }

  /**
   * Save a message (upsert)
   */
  public async saveMessage(message: DMMessage): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([MESSAGES_STORE, CONVERSATIONS_STORE], 'readwrite');
      const messagesStore = tx.objectStore(MESSAGES_STORE);
      const conversationsStore = tx.objectStore(CONVERSATIONS_STORE);

      // Check for duplicate by wrapId
      const wrapIndex = messagesStore.index('wrapId');
      const checkRequest = wrapIndex.get(message.wrapId);

      checkRequest.onsuccess = () => {
        if (checkRequest.result) {
          // Already exists, skip
          resolve();
          return;
        }

        // Save message
        messagesStore.put(message);

        // Update conversation
        const getConvRequest = conversationsStore.get(message.conversationWith);
        getConvRequest.onsuccess = () => {
          const existing = getConvRequest.result as DMConversation | undefined;
          const isNewer = !existing || message.createdAt > existing.lastMessageAt;

          const conversation: DMConversation = {
            pubkey: message.conversationWith,
            lastMessageAt: isNewer ? message.createdAt : existing!.lastMessageAt,
            lastMessagePreview: isNewer ? message.content.slice(0, 100) : existing!.lastMessagePreview,
            unreadCount: message.isMine ? (existing?.unreadCount || 0) : (existing?.unreadCount || 0) + 1,
            subject: message.subject || existing?.subject
          };

          conversationsStore.put(conversation);
        };
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get messages for a conversation (paginated)
   */
  public async getMessages(partnerPubkey: string, limit: number = 50, before?: number): Promise<DMMessage[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(MESSAGES_STORE, 'readonly');
      const store = tx.objectStore(MESSAGES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const allMessages = request.result as DMMessage[];

        // Filter by conversationWith
        let result = allMessages.filter(m => m.conversationWith === partnerPubkey);

        // Apply before filter if specified
        if (before) {
          result = result.filter(m => m.createdAt < before);
        }

        // Sort by createdAt ascending (oldest first for display)
        result = result.sort((a, b) => a.createdAt - b.createdAt);

        // Apply limit (take newest)
        if (result.length > limit) {
          result = result.slice(-limit);
        }

        resolve(result);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get conversations with pagination (sorted by lastMessageAt desc)
   */
  public async getConversations(limit?: number, offset: number = 0): Promise<DMConversation[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const index = store.index('lastMessageAt');
      const conversations: DMConversation[] = [];
      let skipped = 0;

      const request = index.openCursor(null, 'prev');

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(conversations);
          return;
        }

        // Skip items until we reach offset
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        // Check limit
        if (limit !== undefined && conversations.length >= limit) {
          resolve(conversations);
          return;
        }

        conversations.push(cursor.value as DMConversation);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get single conversation by partner pubkey
   */
  public async getConversation(partnerPubkey: string): Promise<DMConversation | null> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const request = store.get(partnerPubkey);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark conversation as read (reset unread count)
   */
  public async markAsRead(partnerPubkey: string): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const request = store.get(partnerPubkey);

      request.onsuccess = () => {
        const conversation = request.result as DMConversation | undefined;
        if (conversation) {
          conversation.unreadCount = 0;
          store.put(conversation);
        }
        resolve();
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Mark all conversations as read
   */
  public async markAllAsRead(): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const conversation = cursor.value as DMConversation;
          if (conversation.unreadCount > 0) {
            conversation.unreadCount = 0;
            cursor.update(conversation);
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Mark all conversations as unread (set unread count to 1)
   */
  public async markAllAsUnread(): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const conversation = cursor.value as DMConversation;
          if (conversation.unreadCount === 0) {
            conversation.unreadCount = 1;
            cursor.update(conversation);
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get total unread count across all conversations
   */
  public async getTotalUnreadCount(): Promise<number> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const conversations = request.result as DMConversation[];
        const total = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
        resolve(total);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if message exists by wrapId
   */
  public async hasMessage(wrapId: string): Promise<boolean> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(MESSAGES_STORE, 'readonly');
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index('wrapId');
      const request = index.get(wrapId);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get newest message timestamp (for subscription since parameter)
   */
  public async getNewestMessageTimestamp(): Promise<number> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(MESSAGES_STORE, 'readonly');
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev');

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          resolve((cursor.value as DMMessage).createdAt);
        } else {
          resolve(0);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all DM data (for logout)
   */
  public async clear(): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([MESSAGES_STORE, CONVERSATIONS_STORE], 'readwrite');
      tx.objectStore(MESSAGES_STORE).clear();
      tx.objectStore(CONVERSATIONS_STORE).clear();

      tx.oncomplete = () => {
        this.systemLogger.info('DMStore', 'All DM data cleared');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}
