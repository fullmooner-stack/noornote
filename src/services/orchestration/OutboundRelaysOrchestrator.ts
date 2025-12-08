/**
 * OutboundRelaysOrchestrator - NIP-65 Multi-User Relay Discovery
 * Fetches relay lists from multiple users to discover "outbound relays"
 * for improved timeline diversity and content discovery
 *
 * @orchestrator OutboundRelaysOrchestrator
 * @purpose Discover additional relays from user's following list
 * @used-by FeedOrchestrator, QuoteOrchestrator, LongFormOrchestrator
 *
 * Architecture:
 * - Fetches kind:10002 relay lists for multiple users (following list)
 * - Aggregates write relays (where users publish content)
 * - Quality filtering to avoid local/test relays
 * - 1-hour cache TTL (relay lists don't change frequently)
 */

import type { NostrEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { Orchestrator } from './Orchestrator';
import { NostrTransport } from '../transport/NostrTransport';
import { RelayConfig } from '../RelayConfig';
import { SystemLogger } from '../../components/system/SystemLogger';

export interface UserRelayList {
  pubkey: string;
  writeRelays: string[];
  readRelays: string[];
  lastUpdated: number;
}

export interface RelayDiscoveryStats {
  totalUsers: number;
  discoveredRelays: number;
  cacheHits: number;
  cacheMisses: number;
}

export class OutboundRelaysOrchestrator extends Orchestrator {
  private static instance: OutboundRelaysOrchestrator;
  private transport: NostrTransport;
  private relayConfig: RelayConfig;
  private systemLogger: SystemLogger;
  private relayListCache: Map<string, UserRelayList> = new Map();
  private stats: RelayDiscoveryStats = {
    totalUsers: 0,
    discoveredRelays: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  // Cache TTL: 1 hour (relay lists don't change frequently)
  private readonly CACHE_TTL = 60 * 60 * 1000;

  private constructor() {
    super('OutboundRelaysOrchestrator');
    this.transport = NostrTransport.getInstance();
    this.relayConfig = RelayConfig.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.systemLogger.info('OutboundRelaysOrchestrator', 'OutboundRelay Orchestrator at your service');
  }

  public static getInstance(): OutboundRelaysOrchestrator {
    if (!OutboundRelaysOrchestrator.instance) {
      OutboundRelaysOrchestrator.instance = new OutboundRelaysOrchestrator();
    }
    return OutboundRelaysOrchestrator.instance;
  }

  /**
   * Fetch NIP-65 relay lists for a batch of users
   * Returns discovered relay information for each user
   */
  public async discoverUserRelays(pubkeys: string[]): Promise<UserRelayList[]> {
    // Use aggregator relays to fetch NIP-65 events (not user's own relays)
    // Otherwise we miss relay lists if user only has private/auth relays
    const baseRelays = this.relayConfig.getAggregatorRelays();
    const results: UserRelayList[] = [];
    const uncachedPubkeys: string[] = [];

    this.systemLogger.info(
      'OutboundRelaysFetcherOrchestrator',
      `Fetching relay lists for ${pubkeys.length} users`
    );

    // Check cache first
    for (const pubkey of pubkeys) {
      const cached = this.getCachedRelayList(pubkey);
      if (cached) {
        results.push(cached);
        this.stats.cacheHits++;
      } else {
        uncachedPubkeys.push(pubkey);
        this.stats.cacheMisses++;
      }
    }

    if (uncachedPubkeys.length === 0) {
      this.systemLogger.info(
        'OutboundRelaysFetcherOrchestrator',
        'All relay lists found in cache'
      );
      return results;
    }

    this.systemLogger.info(
      'OutboundRelaysFetcherOrchestrator',
      `Fetching relay lists for ${uncachedPubkeys.length} uncached users`
    );

    // Fetch NIP-65 events (kind:10002) for uncached users
    const filter: NDKFilter = {
      authors: uncachedPubkeys,
      kinds: [10002], // Relay List Metadata
      limit: uncachedPubkeys.length * 2 // Allow for multiple events per user
    };

    try {
      const events = await this.transport.fetch(baseRelays, [filter], 5000);
      this.systemLogger.info(
        'OutboundRelaysFetcherOrchestrator',
        `Received ${events.length} relay list events`
      );

      // Process each event and extract relay information
      const processedPubkeys = new Set<string>();

      for (const event of events) {
        if (processedPubkeys.has(event.pubkey)) {
          continue; // Skip if we already processed a newer event for this user
        }

        const relayList = this.parseRelayListEvent(event);
        if (relayList) {
          results.push(relayList);
          this.cacheRelayList(relayList);
          processedPubkeys.add(event.pubkey);
        }
      }

      // Add aggregator relay lists for users without NIP-65 events
      // Use big relays as default (like Jumble does) instead of empty list
      const aggregatorRelays = this.relayConfig.getAggregatorRelays();
      for (const pubkey of uncachedPubkeys) {
        if (!processedPubkeys.has(pubkey)) {
          const defaultRelayList: UserRelayList = {
            pubkey,
            writeRelays: aggregatorRelays,
            readRelays: aggregatorRelays,
            lastUpdated: Date.now()
          };
          results.push(defaultRelayList);
          this.cacheRelayList(defaultRelayList);
        }
      }

      this.stats.totalUsers = pubkeys.length;
      this.stats.discoveredRelays = results.reduce(
        (sum, list) => sum + list.writeRelays.length + list.readRelays.length,
        0
      );
    } catch (error) {
      this.systemLogger.error(
        'OutboundRelaysFetcherOrchestrator',
        `Fetch relay lists error: ${error}`
      );
    }

    return results;
  }

  /**
   * Get all discovered write relays from a list of users with quality filtering
   * These are the "outbound relays" where users publish their content
   */
  public getOutboundRelays(userRelayLists: UserRelayList[]): string[] {
    const outboundRelays = new Set<string>();
    const baseRelays = new Set(this.relayConfig.getReadRelays());

    for (const relayList of userRelayLists) {
      // Add write relays (where users publish their content)
      for (const relay of relayList.writeRelays) {
        if (
          this.isValidRelay(relay) &&
          !baseRelays.has(relay) &&
          this.isQualityRelay(relay)
        ) {
          outboundRelays.add(relay);
        }
      }
    }

    const result = Array.from(outboundRelays);
    this.systemLogger.info(
      'OutboundRelaysFetcherOrchestrator',
      `Discovered ${result.length} quality outbound relays from ${userRelayLists.length} users`
    );

    return result;
  }

  /**
   * Get combined relay list: standard + optional outbound relays
   */
  public async getCombinedRelays(
    pubkeys: string[],
    includeOutbound: boolean = true
  ): Promise<string[]> {
    const standardRelays = this.relayConfig.getReadRelays();

    if (!includeOutbound) {
      this.systemLogger.info(
        'OutboundRelaysFetcherOrchestrator',
        `Using ${standardRelays.length} standard relay${standardRelays.length === 1 ? '' : 's'}`
      );
      return standardRelays;
    }

    try {
      const relayLists = await this.discoverUserRelays(pubkeys);
      const outboundRelays = this.getOutboundRelays(relayLists);

      // Always include aggregator relays for ProfileView to ensure content discovery
      // These relays are likely to have cached events even if author's relays are offline
      const aggregatorRelays = this.relayConfig.getAggregatorRelays();

      // Combine: standard + discovered outbound + aggregator (deduplicated)
      const allRelays = [...standardRelays, ...outboundRelays, ...aggregatorRelays];
      const combined = Array.from(new Set(allRelays)); // Deduplicate

      this.systemLogger.info(
        'OutboundRelaysFetcherOrchestrator',
        `${standardRelays.length} own + ${outboundRelays.length} author's + ${aggregatorRelays.length} aggregator = ${combined.length} total (deduplicated)`
      );
      return combined;
    } catch (error) {
      this.systemLogger.error(
        'OutboundRelaysFetcherOrchestrator',
        `Outbound relay discovery failed, using standard relays only: ${error}`
      );
      return standardRelays;
    }
  }

  /**
   * Parse NIP-65 relay list event and extract relay information
   */
  private parseRelayListEvent(event: NostrEvent): UserRelayList | null {
    try {
      const writeRelays: string[] = [];
      const readRelays: string[] = [];

      for (const tag of event.tags) {
        if (tag[0] === 'r' && tag[1]) {
          const relayUrl = tag[1];
          const marker = tag[2]; // 'read', 'write', or undefined

          if (!marker) {
            // No marker means both read and write
            writeRelays.push(relayUrl);
            readRelays.push(relayUrl);
          } else if (marker === 'write') {
            writeRelays.push(relayUrl);
          } else if (marker === 'read') {
            readRelays.push(relayUrl);
          }
        }
      }

      return {
        pubkey: event.pubkey,
        writeRelays: [...new Set(writeRelays)], // Deduplicate
        readRelays: [...new Set(readRelays)], // Deduplicate
        lastUpdated: Date.now()
      };
    } catch (error) {
      this.systemLogger.error(
        'OutboundRelaysFetcherOrchestrator',
        `Parse relay list event error: ${error}`
      );
      return null;
    }
  }

  /**
   * Get cached relay list if still valid
   */
  private getCachedRelayList(pubkey: string): UserRelayList | null {
    const cached = this.relayListCache.get(pubkey);
    if (cached && Date.now() - cached.lastUpdated < this.CACHE_TTL) {
      return cached;
    }

    if (cached) {
      this.relayListCache.delete(pubkey); // Remove expired cache
    }

    return null;
  }

  /**
   * Cache relay list
   */
  private cacheRelayList(relayList: UserRelayList): void {
    this.relayListCache.set(relayList.pubkey, relayList);
  }

  /**
   * Validate relay URL
   */
  private isValidRelay(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
    } catch {
      return false;
    }
  }

  /**
   * Check if relay meets quality standards for outbound discovery
   * Uses RelayConfig's known relays as trusted base, minimal filtering
   */
  private isQualityRelay(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Check if this relay is already in our RelayConfig (automatically trusted)
      const configuredRelays = this.relayConfig.getAllRelays();
      const isConfiguredRelay = configuredRelays.some(relay => {
        try {
          const configUrl = new URL(relay.url);
          return configUrl.hostname.toLowerCase() === hostname;
        } catch {
          return false;
        }
      });

      if (isConfiguredRelay) {
        return true;
      }

      // Check RelayConfig aggregator relays (also trusted)
      const aggregatorRelays = this.relayConfig.getAggregatorRelays();
      const isAggregatorRelay = aggregatorRelays.some(relay => {
        try {
          const relayUrl = new URL(relay);
          return relayUrl.hostname.toLowerCase() === hostname;
        } catch {
          return false;
        }
      });

      if (isAggregatorRelay) {
        return true;
      }

      // Only filter out clearly local/test relays
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.includes('.local') ||
        hostname.startsWith('test.') ||
        hostname.startsWith('dev.') ||
        hostname.startsWith('staging.')
      ) {
        return false;
      }

      // Default: accept valid-looking domains (minimal filtering)
      return hostname.includes('.') && hostname.length > 4 && !hostname.includes('localhost');
    } catch {
      return false;
    }
  }

  /**
   * Get discovery statistics
   */
  public getStats(): RelayDiscoveryStats {
    return { ...this.stats };
  }

  /**
   * Clear relay list cache
   */
  public clearCache(): void {
    this.relayListCache.clear();
    this.systemLogger.info('OutboundRelaysFetcherOrchestrator', 'Cache cleared');
  }

  /**
   * Get cache status
   */
  public getCacheStatus(): { size: number; ttl: number } {
    return {
      size: this.relayListCache.size,
      ttl: this.CACHE_TTL
    };
  }

  // Orchestrator interface implementations

  public onui(_data: any): void {
    // Handle UI actions (future: relay discovery updates)
  }

  public onopen(_relay: string): void {
    // Silent operation
  }

  public onmessage(_relay: string, _event: NostrEvent): void {
    // Handle incoming events (future: real-time relay list updates)
  }

  public onerror(relay: string, error: Error): void {
    this.systemLogger.error(
      'OutboundRelaysFetcherOrchestrator',
      `Relay error (${relay}): ${error.message}`
    );
  }

  public onclose(_relay: string): void {
    // Silent operation
  }

  public override destroy(): void {
    this.relayListCache.clear();
    super.destroy();
    this.systemLogger.info('OutboundRelaysFetcherOrchestrator', 'Destroyed');
  }
}
