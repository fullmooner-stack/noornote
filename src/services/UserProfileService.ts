/**
 * User Profile Service
 * Resolves user pubkeys to usernames, profile pictures, and metadata
 * Uses ProfileOrchestrator for fetching
 *
 * MINIMAL CACHE STRATEGY:
 * - Memory-only cache (no localStorage)
 * - No TTL (fresh on every app start)
 * - Background fetching for performance
 */

import { ProfileOrchestrator } from './orchestration/ProfileOrchestrator';
import type { Profile } from './orchestration/ProfileOrchestrator';
import { extractDisplayName } from '../helpers/extractDisplayName';

export interface UserProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  username?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  nip05s?: string[]; // Multiple NIP-05 addresses from tags (Animestr-style)
  verified?: boolean;
  lud06?: string;
  lud16?: string;
  website?: string;
  banner?: string;
  lastUpdated?: number;
}

export class UserProfileService {
  private static instance: UserProfileService;

  // NO CACHING - removed all cache Maps

  private orchestrator: ProfileOrchestrator;
  private fetchingProfiles: Map<string, Promise<UserProfile>> = new Map();
  private profileUpdateCallbacks: Map<string, Set<(profile: UserProfile) => void>> = new Map();

  /** Track failed fetches to prevent rapid retry storms (pubkey → timestamp) */
  private failedFetches: Map<string, number> = new Map();
  private readonly FAILED_FETCH_COOLDOWN = 2000; // 2 seconds

  private constructor() {
    this.orchestrator = ProfileOrchestrator.getInstance();
  }

  public static getInstance(): UserProfileService {
    if (!UserProfileService.instance) {
      UserProfileService.instance = new UserProfileService();
    }
    return UserProfileService.instance;
  }

  /**
   * Get username ONLY (lightweight, fast)
   * Returns cached username or null if not yet loaded
   * Triggers background fetch if not in cache
   */
  public getUsername(pubkey: string): string | null {
    // NO CACHE - always return null
    // Use subscribeToProfile() instead
    return null;
  }

  /**
   * Get profile picture ONLY (lightweight, fast)
   * Returns cached picture or null if not yet loaded
   * Triggers background fetch if not in cache
   */
  public getProfilePicture(pubkey: string): string | null {
    // NO CACHE - always return null
    // Use subscribeToProfile() instead
    return null;
  }

  /**
   * Get full user profile
   * Returns cached profile or fetches from relays
   */
  public async getUserProfile(pubkey: string): Promise<UserProfile> {
    // NO CACHE - always fetch fresh from relays

    // Deduplication: if already fetching, wait for that request
    if (this.fetchingProfiles.has(pubkey)) {
      return await this.fetchingProfiles.get(pubkey)!;
    }

    // Check if recently failed - return default profile during cooldown
    const lastFailed = this.failedFetches.get(pubkey);
    if (lastFailed && Date.now() - lastFailed < this.FAILED_FETCH_COOLDOWN) {
      return this.getDefaultProfile(pubkey);
    }

    // Start new fetch
    const fetchPromise = this.fetchProfileFromRelays(pubkey);
    this.fetchingProfiles.set(pubkey, fetchPromise);

    try {
      const profile = await fetchPromise;

      // Clear any previous failure on success
      this.failedFetches.delete(pubkey);

      // NO CACHING - just notify subscribers and return
      this.notifyProfileUpdate(pubkey, profile);
      return profile;
    } catch (error) {
      console.warn(`Failed to fetch profile for ${pubkey}:`, error);
      // Record failure timestamp to prevent rapid retries
      this.failedFetches.set(pubkey, Date.now());
      return this.getDefaultProfile(pubkey);
    } finally {
      this.fetchingProfiles.delete(pubkey);
    }
  }

  /**
   * Check if user is verified (has valid NIP-05)
   */
  public isVerified(profile: UserProfile): boolean {
    return profile.verified === true && !!profile.nip05;
  }

  /**
   * Fetch multiple user profiles efficiently
   */
  public async getUserProfiles(pubkeys: string[]): Promise<Map<string, UserProfile>> {
    // NO CACHE - always fetch all
    try {
      const fetchedProfiles = await this.fetchMultipleProfilesFromRelays(pubkeys);
      return fetchedProfiles;
    } catch (error) {
      console.warn('Failed to fetch user profiles:', error);

      // Return default profiles for all on error
      const profiles = new Map<string, UserProfile>();
      pubkeys.forEach(pubkey => {
        profiles.set(pubkey, this.getDefaultProfile(pubkey));
      });
      return profiles;
    }
  }

  /**
   * Fetch single profile from relays (via ProfileOrchestrator)
   */
  private async fetchProfileFromRelays(pubkey: string): Promise<UserProfile> {
    const profile = await this.orchestrator.fetchProfile(pubkey);

    if (profile) {
      return profile as UserProfile;
    }

    // Return default profile if fetch failed
    return this.getDefaultProfile(pubkey);
  }

  /**
   * Fetch multiple profiles efficiently (via ProfileOrchestrator)
   */
  private async fetchMultipleProfilesFromRelays(pubkeys: string[]): Promise<Map<string, UserProfile>> {
    const profiles = await this.orchestrator.fetchMultipleProfiles(pubkeys);

    // Convert to UserProfile format and add defaults for missing
    const result = new Map<string, UserProfile>();

    pubkeys.forEach(pubkey => {
      const profile = profiles.get(pubkey);
      if (profile) {
        result.set(pubkey, profile as UserProfile);
      } else {
        result.set(pubkey, this.getDefaultProfile(pubkey));
      }
    });

    return result;
  }

  /**
   * Create default profile for a pubkey
   */
  private getDefaultProfile(pubkey: string): UserProfile {
    return {
      pubkey,
      lastUpdated: Date.now()
    };
  }

  /**
   * Subscribe to profile updates (like nostr-react useProfile pattern)
   */
  public subscribeToProfile(pubkey: string, callback: (profile: UserProfile) => void): () => void {
    if (!this.profileUpdateCallbacks.has(pubkey)) {
      this.profileUpdateCallbacks.set(pubkey, new Set());
    }

    this.profileUpdateCallbacks.get(pubkey)!.add(callback);

    // NO CACHE - always fetch
    this.getUserProfile(pubkey).then(callback).catch(() => {
      // Silent fail
    });

    // Return unsubscribe function
    return () => {
      const callbacks = this.profileUpdateCallbacks.get(pubkey);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.profileUpdateCallbacks.delete(pubkey);
        }
      }
    };
  }

  /**
   * Notify all subscribers when profile updates
   */
  private notifyProfileUpdate(pubkey: string, profile: UserProfile): void {
    const callbacks = this.profileUpdateCallbacks.get(pubkey);
    if (callbacks) {
      callbacks.forEach(callback => callback(profile));
    }
  }

  /**
   * Clear all cached profiles (NO-OP - no cache exists)
   */
  public clearCache(): void {
    // NO CACHE - nothing to clear
    console.log('UserProfileService: No cache to clear');
  }
}
