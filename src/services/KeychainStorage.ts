/**
 * Keychain Storage Service
 * Secure storage for sensitive data (nsec, NWC connection strings)
 * Uses macOS Keychain in Tauri, falls back to IndexedDB in browser
 *
 * IndexedDB is used instead of localStorage because:
 * - Not synchronously accessible via JS (harder to exploit via XSS)
 * - Isolated per origin
 * - Still not fully secure in browser - use desktop app for best security
 */

import { setPassword, getPassword, deletePassword } from 'tauri-plugin-keyring-api';
import { ToastService } from './ToastService';
import { PlatformService } from './PlatformService';

// IndexedDB database name and store
const DB_NAME = 'noornote_secure';
const STORE_NAME = 'keychain';
const DB_VERSION = 1;

export class KeychainStorage {
  private static readonly SERVICE_NAME = 'noornote';
  private static readonly KEY_NSEC = 'nsec';
  private static readonly KEY_NWC = 'nwc_connection';

  private static dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Check if running in Tauri environment
   */
  private static isTauri(): boolean {
    return PlatformService.getInstance().isTauri;
  }

  /**
   * Get IndexedDB database (lazy initialization)
   */
  private static getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error('Failed to open IndexedDB:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
      });
    }
    return this.dbPromise;
  }

  /**
   * Get value from IndexedDB
   */
  private static async getFromIndexedDB(key: string): Promise<string | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result?.value ?? null);
      };
    });
  }

  /**
   * Set value in IndexedDB
   */
  private static async setInIndexedDB(key: string, value: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ key, value });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Delete value from IndexedDB
   */
  private static async deleteFromIndexedDB(key: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Save nsec private key
   */
  static async saveNsec(nsec: string): Promise<void> {
    if (this.isTauri()) {
      try {
        await setPassword(this.SERVICE_NAME, this.KEY_NSEC, nsec);
      } catch (_error) {
        console.error('Failed to save nsec to Keychain:', _error);
        throw new Error('Failed to save private key to Keychain');
      }
    } else {
      // Browser fallback - IndexedDB (still warn about security)
      await this.setInIndexedDB(this.KEY_NSEC, nsec);
      ToastService.show('⚠️ Using IndexedDB. Desktop app recommended for better security.', 'warning');
    }
  }

  /**
   * Load nsec private key
   */
  static async loadNsec(): Promise<string | null> {
    if (this.isTauri()) {
      try {
        return await getPassword(this.SERVICE_NAME, this.KEY_NSEC);
      } catch (_error) {
        // Key not found in Keychain
        return null;
      }
    } else {
      // Browser fallback - IndexedDB
      return this.getFromIndexedDB(this.KEY_NSEC);
    }
  }

  /**
   * Delete nsec private key
   */
  static async deleteNsec(): Promise<void> {
    if (this.isTauri()) {
      try {
        await deletePassword(this.SERVICE_NAME, this.KEY_NSEC);
      } catch (_error) {
        // Ignore errors (key might not exist)
      }
    } else {
      await this.deleteFromIndexedDB(this.KEY_NSEC);
    }
  }

  /**
   * Save NWC connection string
   */
  static async saveNWC(connectionString: string): Promise<void> {
    if (this.isTauri()) {
      try {
        await setPassword(this.SERVICE_NAME, this.KEY_NWC, connectionString);
      } catch (_error) {
        console.error('Failed to save NWC to Keychain:', _error);
        throw new Error('Failed to save NWC connection to Keychain');
      }
    } else {
      // Browser fallback - IndexedDB
      await this.setInIndexedDB(this.KEY_NWC, connectionString);
    }
  }

  /**
   * Load NWC connection string
   */
  static async loadNWC(): Promise<string | null> {
    if (this.isTauri()) {
      try {
        return await getPassword(this.SERVICE_NAME, this.KEY_NWC);
      } catch (_error) {
        return null;
      }
    } else {
      return this.getFromIndexedDB(this.KEY_NWC);
    }
  }

  /**
   * Delete NWC connection string
   */
  static async deleteNWC(): Promise<void> {
    if (this.isTauri()) {
      try {
        await deletePassword(this.SERVICE_NAME, this.KEY_NWC);
      } catch (_error) {
        // Ignore errors
      }
    } else {
      await this.deleteFromIndexedDB(this.KEY_NWC);
    }
  }

  /**
   * Save zap defaults (amount + comment) to localStorage
   * Non-sensitive data, localStorage is fine
   */
  static async saveZapDefaults(amount: number, comment: string): Promise<void> {
    try {
      localStorage.setItem('noornote_zap_defaults', JSON.stringify({ amount, comment }));
    } catch (_error) {
      console.error('Failed to save zap defaults to localStorage:', _error);
      throw new Error('Failed to save zap defaults');
    }
  }

  /**
   * Load zap defaults (amount + comment) from localStorage
   */
  static async loadZapDefaults(): Promise<{ amount: number; comment: string } | null> {
    try {
      const stored = localStorage.getItem('noornote_zap_defaults');
      if (!stored) return null;
      return JSON.parse(stored);
    } catch (_error) {
      console.error('Failed to load zap defaults from localStorage:', _error);
      return null;
    }
  }

  /**
   * Delete zap defaults from localStorage
   */
  static async deleteZapDefaults(): Promise<void> {
    try {
      localStorage.removeItem('noornote_zap_defaults');
    } catch (_error) {
      // Ignore errors
    }
  }

  /**
   * Save fiat currency preference to localStorage
   * Non-sensitive data, localStorage is fine
   */
  static async saveFiatCurrency(currencyCode: string): Promise<void> {
    try {
      localStorage.setItem('noornote_fiat_currency', currencyCode);
    } catch (_error) {
      console.error('Failed to save fiat currency to localStorage:', _error);
      throw new Error('Failed to save fiat currency');
    }
  }

  /**
   * Load fiat currency preference from localStorage
   */
  static async loadFiatCurrency(): Promise<string | null> {
    try {
      return localStorage.getItem('noornote_fiat_currency');
    } catch (_error) {
      console.error('Failed to load fiat currency from localStorage:', _error);
      return null;
    }
  }

  /**
   * Clear all stored credentials (including NWC)
   * WARNING: Only use this for complete app reset, NOT for logout
   */
  static async clearAll(): Promise<void> {
    await this.deleteNsec();
    await this.deleteNWC();
  }

  /**
   * Clear only auth credentials (nsec)
   * NWC remains persistent across auth sessions
   */
  static async clearAuth(): Promise<void> {
    await this.deleteNsec();
  }
}
