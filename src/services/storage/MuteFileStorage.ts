/**
 * MuteFileStorage
 * File-based storage for mute lists using Tauri FS API
 *
 * Stores mute lists in 2 separate local JSON files:
 * - ~/.noornote/mutes-public.json
 * - ~/.noornote/mutes-private.json
 * - Accessible even when app is not running
 * - Can be manually edited/backed up
 * - Single source of truth for mutes
 */

import { BaseFileStorage, type BaseFileData } from './BaseFileStorage';

export interface MuteListData extends BaseFileData {
  items: string[];      // Array of pubkeys (users)
  eventIds: string[];   // Array of event IDs (threads)
}

/**
 * Public mute list storage
 */
class PublicMuteStorage extends BaseFileStorage<MuteListData> {
  protected getFileName(): string {
    return 'mutes-public.json';
  }

  protected getDefaultData(): MuteListData {
    return {
      items: [],
      eventIds: [],
      lastModified: Math.floor(Date.now() / 1000)
    };
  }

  protected getLoggerName(): string {
    return 'PublicMuteStorage';
  }

  /**
   * Migration: Add eventIds array if missing (backward compatibility)
   */
  protected override migrateData(data: MuteListData): MuteListData {
    if (!Array.isArray(data.eventIds)) {
      data.eventIds = [];
    }
    return data;
  }
}

/**
 * Private mute list storage
 */
class PrivateMuteStorage extends BaseFileStorage<MuteListData> {
  protected getFileName(): string {
    return 'mutes-private.json';
  }

  protected getDefaultData(): MuteListData {
    return {
      items: [],
      eventIds: [],
      lastModified: Math.floor(Date.now() / 1000)
    };
  }

  protected getLoggerName(): string {
    return 'PrivateMuteStorage';
  }

  /**
   * Migration: Add eventIds array if missing (backward compatibility)
   */
  protected override migrateData(data: MuteListData): MuteListData {
    if (!Array.isArray(data.eventIds)) {
      data.eventIds = [];
    }
    return data;
  }
}

/**
 * MuteFileStorage - Facade for managing both public and private mute lists
 */
export class MuteFileStorage {
  private static instance: MuteFileStorage;
  private publicStorage: PublicMuteStorage;
  private privateStorage: PrivateMuteStorage;

  private constructor() {
    this.publicStorage = new PublicMuteStorage();
    this.privateStorage = new PrivateMuteStorage();
  }

  public static getInstance(): MuteFileStorage {
    if (!MuteFileStorage.instance) {
      MuteFileStorage.instance = new MuteFileStorage();
    }
    return MuteFileStorage.instance;
  }

  /**
   * Initialize both file storages (must be called before any file operations)
   */
  public async initialize(): Promise<void> {
    await Promise.all([
      this.publicStorage.initialize(),
      this.privateStorage.initialize()
    ]);
  }

  /**
   * Read public mute list
   */
  public async readPublic(): Promise<MuteListData> {
    return await this.publicStorage.read();
  }

  /**
   * Read private mute list
   */
  public async readPrivate(): Promise<MuteListData> {
    return await this.privateStorage.read();
  }

  /**
   * Write public mute list
   */
  public async writePublic(data: MuteListData): Promise<void> {
    await this.publicStorage.write(data);
  }

  /**
   * Write private mute list
   */
  public async writePrivate(data: MuteListData): Promise<void> {
    await this.privateStorage.write(data);
  }

  // ===== User Mute Methods =====

  /**
   * Add public mute (user)
   */
  public async addPublicMute(pubkey: string): Promise<void> {
    const data = await this.readPublic();

    if (!data.items.includes(pubkey)) {
      data.items.push(pubkey);
      await this.writePublic(data);
    }
  }

  /**
   * Add private mute (user)
   */
  public async addPrivateMute(pubkey: string): Promise<void> {
    const data = await this.readPrivate();

    if (!data.items.includes(pubkey)) {
      data.items.push(pubkey);
      await this.writePrivate(data);
    }
  }

  /**
   * Remove mute from both lists (user)
   */
  public async removeMute(pubkey: string): Promise<void> {
    const publicData = await this.readPublic();
    const privateData = await this.readPrivate();

    publicData.items = publicData.items.filter(pk => pk !== pubkey);
    privateData.items = privateData.items.filter(pk => pk !== pubkey);

    await this.writePublic(publicData);
    await this.writePrivate(privateData);
  }

  /**
   * Get all mutes (merged public + private, deduplicated)
   */
  public async getAllMutes(): Promise<string[]> {
    const publicData = await this.readPublic();
    const privateData = await this.readPrivate();
    return [...new Set([...publicData.items, ...privateData.items])];
  }

  /**
   * Check if user is muted
   */
  public async isMuted(pubkey: string): Promise<{ public: boolean; private: boolean }> {
    const publicData = await this.readPublic();
    const privateData = await this.readPrivate();

    return {
      public: publicData.items.includes(pubkey),
      private: privateData.items.includes(pubkey)
    };
  }

  // ===== Thread/Event Mute Methods =====

  /**
   * Add public thread mute (event ID)
   */
  public async addPublicThreadMute(eventId: string): Promise<void> {
    const data = await this.readPublic();

    if (!data.eventIds.includes(eventId)) {
      data.eventIds.push(eventId);
      await this.writePublic(data);
    }
  }

  /**
   * Add private thread mute (event ID)
   */
  public async addPrivateThreadMute(eventId: string): Promise<void> {
    const data = await this.readPrivate();

    if (!data.eventIds.includes(eventId)) {
      data.eventIds.push(eventId);
      await this.writePrivate(data);
    }
  }

  /**
   * Remove thread mute from both lists (event ID)
   */
  public async removeThreadMute(eventId: string): Promise<void> {
    const publicData = await this.readPublic();
    const privateData = await this.readPrivate();

    publicData.eventIds = publicData.eventIds.filter(id => id !== eventId);
    privateData.eventIds = privateData.eventIds.filter(id => id !== eventId);

    await this.writePublic(publicData);
    await this.writePrivate(privateData);
  }

  /**
   * Get all muted event IDs (merged public + private, deduplicated)
   */
  public async getAllMutedEventIds(): Promise<string[]> {
    const publicData = await this.readPublic();
    const privateData = await this.readPrivate();
    return [...new Set([...publicData.eventIds, ...privateData.eventIds])];
  }

  /**
   * Check if event/thread is muted
   */
  public async isEventMuted(eventId: string): Promise<{ public: boolean; private: boolean }> {
    const publicData = await this.readPublic();
    const privateData = await this.readPrivate();

    return {
      public: publicData.eventIds.includes(eventId),
      private: privateData.eventIds.includes(eventId)
    };
  }

  /**
   * Get file paths (for debugging/manual access)
   */
  public getFilePaths(): { public: string | null; private: string | null } {
    return {
      public: this.publicStorage.getFilePath(),
      private: this.privateStorage.getFilePath()
    };
  }
}
