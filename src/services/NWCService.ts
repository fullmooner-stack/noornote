/**
 * NWCService - Nostr Wallet Connect Service
 * Handles NWC connection and Lightning invoice payments (NIP-47)
 *
 * NIP-47: https://github.com/nostr-protocol/nips/blob/master/47.md
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import { decodeNip19, nip04, finalizeEvent, getPublicKeyFromPrivate } from './NostrToolsAdapter';
import { NostrTransport } from './transport/NostrTransport';
import { SystemLogger } from '../components/system/SystemLogger';
import { ErrorService } from './ErrorService';
import { ToastService } from './ToastService';
import { KeychainStorage } from './KeychainStorage';
import { SignatureVerificationService } from './security/SignatureVerificationService';

export type NWCConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface NWCConnection {
  walletPubkey: string;
  relay: string;
  secret: string;
  lud16?: string; // Optional Lightning Address (e.g., user@getalby.com)
}

export interface PayInvoiceResult {
  success: boolean;
  preimage?: string;
  error?: string;
}

export class NWCService {
  private static instance: NWCService;
  private systemLogger: SystemLogger;
  private transport: NostrTransport;
  private connection: NWCConnection | null = null;
  private state: NWCConnectionState = 'disconnected';

  private constructor() {
    this.systemLogger = SystemLogger.getInstance();
    this.transport = NostrTransport.getInstance();

    // Try to restore connection from KeychainStorage (async, runs in background)
    this.restoreConnection();
  }

  public static getInstance(): NWCService {
    if (!NWCService.instance) {
      NWCService.instance = new NWCService();
    }
    return NWCService.instance;
  }

  /**
   * Parse NWC connection string
   * Format: nostr+walletconnect://<wallet-pubkey>?relay=<relay-url>&secret=<secret-hex>&lud16=<lightning-address>
   */
  private parseConnectionString(connectionString: string): NWCConnection {
    try {
      const url = new URL(connectionString);

      // Extract pubkey from pathname or host (some formats use host, some use pathname)
      let walletPubkey = url.pathname || url.host;

      // Remove leading slash if present
      if (walletPubkey.startsWith('/')) {
        walletPubkey = walletPubkey.substring(1);
      }

      // Decode npub to hex if needed
      if (walletPubkey.startsWith('npub')) {
        const decoded = decodeNip19(walletPubkey);
        if (decoded.type === 'npub') {
          walletPubkey = decoded.data as string;
        }
      }

      const relay = url.searchParams.get('relay');
      const secret = url.searchParams.get('secret');
      const lud16 = url.searchParams.get('lud16'); // Optional Lightning Address

      if (!walletPubkey || !relay || !secret) {
        throw new Error('Missing required parameters (pubkey, relay, or secret)');
      }

      return {
        walletPubkey,
        relay,
        secret,
        lud16: lud16 || undefined // URL.searchParams.get() auto-decodes %40 to @
      };
    } catch (error) {
      this.systemLogger.error('NWCService', 'Failed to parse connection string:', error);
      throw new Error('Invalid NWC connection string format');
    }
  }

  /**
   * Connect to NWC wallet
   */
  public async connect(connectionString: string): Promise<boolean> {
    this.state = 'connecting';

    try {
      // Parse connection string
      const connection = this.parseConnectionString(connectionString);

      // Test connection by sending info request
      const isValid = await this.testConnection(connection);

      if (!isValid) {
        this.state = 'error';
        ToastService.show('Verbindung zum Wallet fehlgeschlagen', 'error');
        return false;
      }

      // Store connection
      this.connection = connection;
      this.state = 'connected';

      // Persist to KeychainStorage (secure)
      await this.saveConnection(connectionString);

      this.systemLogger.info('NWCService', 'Connected to NWC wallet:', connection.walletPubkey.slice(0, 8));
      ToastService.show('Lightning Wallet verbunden', 'success');

      return true;
    } catch (error) {
      this.state = 'error';
      ErrorService.handle(
        error,
        'NWCService.connect',
        true,
        'NWC-Verbindung fehlgeschlagen. Bitte prüfe den Connection String.'
      );
      return false;
    }
  }

  /**
   * Test NWC connection by sending get_info request
   */
  private async testConnection(connection: NWCConnection): Promise<boolean> {
    try {
      // Create get_info request
      const content = JSON.stringify({
        method: 'get_info'
      });

      // Encrypt content with NIP-04
      const appSecretKey = this.hexToBytes(connection.secret);
      const appPubkey = getPublicKeyFromPrivate(appSecretKey);
      const encryptedContent = await nip04.encrypt(connection.secret, connection.walletPubkey, content);

      // Create NWC request event (kind 23194)
      const event = finalizeEvent({
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', connection.walletPubkey]],
        content: encryptedContent
      }, appSecretKey);

      // Ensure NWC relay is connected before publishing
      const connected = await this.transport.connectToRelay(connection.relay);
      if (!connected) {
        this.systemLogger.warn('NWCService', `Failed to connect to NWC relay: ${connection.relay}`);
        return false;
      }

      // Publish to relay and wait for response
      await this.transport.publish([connection.relay], event);

      // Listen for response (kind 23195) - timeout after 5 seconds
      return new Promise(async (resolve) => {
        const sub = await this.transport.subscribe([connection.relay], [
          {
            kinds: [23195],
            authors: [connection.walletPubkey],
            '#p': [appPubkey],
            since: Math.floor(Date.now() / 1000)
          }
        ], {
          onEvent: async (event: NostrEvent) => {
            // NostrTransport already verified signature
            clearTimeout(timeout);
            sub.close();

            // Decrypt response
            try {
              const decrypted = await nip04.decrypt(connection.secret, connection.walletPubkey, event.content);
              const response = JSON.parse(decrypted);

              // Check if response has result (successful get_info)
              resolve(!!response.result);
            } catch (error) {
              this.systemLogger.error('NWCService', 'Failed to decrypt response:', error);
              resolve(false);
            }
          }
        });

        const timeout = setTimeout(() => {
          sub.close();
          resolve(false);
        }, 5000);
      });
    } catch (error) {
      this.systemLogger.error('NWCService', 'Test connection failed:', error);
      return false;
    }
  }

  /**
   * Disconnect from NWC wallet
   * CRITICAL: This is the ONLY method that may delete the stored connection
   */
  public async disconnect(): Promise<void> {
    this.systemLogger.warn('NWCService', '⚠️ DISCONNECT called - removing stored NWC connection');

    this.connection = null;
    this.state = 'disconnected';

    // ONLY place where NWC connection may be deleted from KeychainStorage
    try {
      await KeychainStorage.deleteNWC();
      this.systemLogger.info('NWCService', '✓ Stored NWC connection removed from secure storage');
    } catch (error) {
      this.systemLogger.error('NWCService', 'Failed to remove stored connection:', error);
    }

    this.systemLogger.info('NWCService', 'Disconnected from NWC wallet');
    ToastService.show('Lightning Wallet getrennt', 'info');
  }

  /**
   * Check if connected to NWC wallet
   * Returns true if connection exists, regardless of test state
   * (connection test may fail due to relay timeout, but connection is still usable)
   */
  public isConnected(): boolean {
    return this.connection !== null;
  }

  /**
   * Get current connection state
   */
  public getState(): NWCConnectionState {
    return this.state;
  }

  /**
   * Get wallet pubkey (if connected)
   */
  public getWalletPubkey(): string | null {
    return this.connection?.walletPubkey || null;
  }

  /**
   * Get Lightning Address (lud16) from NWC connection (if available)
   */
  public getLightningAddress(): string | null {
    return this.connection?.lud16 || null;
  }

  /**
   * Get wallet balance via NWC
   */
  public async getBalance(): Promise<number | null> {
    if (!this.isConnected() || !this.connection) {
      return null;
    }

    try {
      // Create get_balance request
      const content = JSON.stringify({
        method: 'get_balance',
        params: {}
      });

      // Encrypt content with NIP-04
      const appSecretKey = this.hexToBytes(this.connection.secret);
      const appPubkey = getPublicKeyFromPrivate(appSecretKey);
      const encryptedContent = await nip04.encrypt(this.connection.secret, this.connection.walletPubkey, content);

      // Create NWC request event (kind 23194)
      const event = finalizeEvent({
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.connection.walletPubkey]],
        content: encryptedContent
      }, appSecretKey);

      // Publish to relay
      await this.transport.publish([this.connection.relay], event);

      // Wait for response (kind 23195) - timeout after 10 seconds
      return new Promise(async (resolve) => {
        const sub = await this.transport.subscribe([this.connection!.relay], [
          {
            kinds: [23195],
            authors: [this.connection!.walletPubkey],
            '#p': [appPubkey],
            since: Math.floor(Date.now() / 1000)
          }
        ], {
          onEvent: async (event: NostrEvent) => {
            // NostrTransport already verified signature
            clearTimeout(timeout);
            sub.close();

            try {
              // Decrypt response
              const decrypted = await nip04.decrypt(this.connection!.secret, this.connection!.walletPubkey, event.content);
              const response = JSON.parse(decrypted);

              if (response.error) {
                this.systemLogger.error('NWCService', 'Get balance failed:', response.error.message);
                resolve(null);
              } else if (response.result && typeof response.result.balance === 'number') {
                // Balance is returned in millisatoshis
                resolve(response.result.balance);
              } else {
                resolve(null);
              }
            } catch (error) {
              this.systemLogger.error('NWCService', 'Failed to decrypt balance response:', error);
              resolve(null);
            }
          }
        });

        const timeout = setTimeout(() => {
          sub.close();
          resolve(null);
        }, 10000);
      });
    } catch (error) {
      this.systemLogger.error('NWCService', 'Get balance failed:', error);
      return null;
    }
  }

  /**
   * Pay Lightning invoice via NWC
   */
  public async payInvoice(invoice: string): Promise<PayInvoiceResult> {
    if (!this.isConnected() || !this.connection) {
      return {
        success: false,
        error: 'Not connected to NWC wallet'
      };
    }

    try {
      // Create pay_invoice request
      const content = JSON.stringify({
        method: 'pay_invoice',
        params: {
          invoice
        }
      });

      // Encrypt content with NIP-04
      const appSecretKey = this.hexToBytes(this.connection.secret);
      const appPubkey = getPublicKeyFromPrivate(appSecretKey);
      const encryptedContent = await nip04.encrypt(this.connection.secret, this.connection.walletPubkey, content);

      // Create NWC request event (kind 23194)
      const event = finalizeEvent({
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.connection.walletPubkey]],
        content: encryptedContent
      }, appSecretKey);

      this.systemLogger.info('NWCService', 'Sending pay_invoice request...');

      // Publish to relay
      await this.transport.publish([this.connection.relay], event);

      // Wait for response (kind 23195) - timeout after 30 seconds
      return new Promise(async (resolve) => {
        const sub = await this.transport.subscribe([this.connection!.relay], [
          {
            kinds: [23195],
            authors: [this.connection!.walletPubkey],
            '#p': [appPubkey],
            since: Math.floor(Date.now() / 1000)
          }
        ], {
          onEvent: async (event: NostrEvent) => {
            // NostrTransport already verified signature
            clearTimeout(timeout);
            sub.close();

            try {
              // Decrypt response
              const decrypted = await nip04.decrypt(this.connection!.secret, this.connection!.walletPubkey, event.content);
              const response = JSON.parse(decrypted);

              if (response.error) {
                this.systemLogger.error('NWCService', 'Payment failed:', response.error.message);
                resolve({
                  success: false,
                  error: response.error.message || 'Payment failed'
                });
              } else if (response.result) {
                // Format payment info for readable log
                const amount = response.result.amount ? Math.floor(response.result.amount / 1000) : 0;
                const fees = response.result.fees_paid ? Math.floor(response.result.fees_paid / 1000) : 0;
                this.systemLogger.info('NWCService', `${amount} Sats sent, ${fees} Sats fees paid`);

                resolve({
                  success: true,
                  preimage: response.result.preimage
                });
              } else {
                resolve({
                  success: false,
                  error: 'Invalid response'
                });
              }
            } catch (error) {
              this.systemLogger.error('NWCService', 'Failed to decrypt payment response:', error);
              resolve({
                success: false,
                error: 'Failed to decrypt response'
              });
            }
          }
        });

        const timeout = setTimeout(() => {
          sub.close();
          resolve({
            success: false,
            error: 'Payment timeout'
          });
        }, 30000);
      });
    } catch (error) {
      this.systemLogger.error('NWCService', 'Payment failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Save connection to localStorage
   */
  private async saveConnection(connectionString: string): Promise<void> {
    try {
      await KeychainStorage.saveNWC(connectionString);
      this.systemLogger.info('NWCService', 'NWC connection saved to secure storage');
    } catch (error) {
      this.systemLogger.error('NWCService', 'Failed to save connection:', error);
      throw error;
    }
  }

  /**
   * Restore connection from KeychainStorage and auto-reconnect
   * CRITICAL: Never delete stored connection automatically - only on explicit disconnect()
   */
  private async restoreConnection(): Promise<void> {
    try {
      const stored = await KeychainStorage.loadNWC();
      if (stored) {
        this.systemLogger.info('NWCService', 'Found stored connection, attempting to reconnect...');

        // Parse and store connection immediately (even if test fails)
        const connection = this.parseConnectionString(stored);
        this.connection = connection;

        // Test connection (but don't block on failure)
        const isValid = await this.testConnection(connection);

        if (isValid) {
          this.state = 'connected';
          this.systemLogger.info('NWCService', 'Auto-reconnected to NWC wallet');

          // Dispatch event to notify UI
          window.dispatchEvent(new CustomEvent('nwc-connection-restored'));
        } else {
          // Connection test failed, but KEEP stored connection
          // User must explicitly disconnect to remove it
          this.state = 'error';
          this.systemLogger.warn('NWCService', 'Failed to auto-reconnect (relay offline?), but connection kept. Use disconnect() to remove.');
        }
      }
    } catch (error) {
      this.systemLogger.error('NWCService', 'Failed to restore connection:', error);
      // NEVER delete stored connection on errors - only on explicit disconnect()
    }
  }

  /**
   * Convert hex string to Uint8Array
   */
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
}
