/**
 * Account Switcher Component
 * Shows current user with dropdown for switching between stored accounts.
 * Supports both local accounts (nsec/extension) and NoorSigner accounts.
 */

import { UserProfileService, UserProfile } from '../../services/UserProfileService';
import { AuthService } from '../../services/AuthService';
import { AccountStorageService, type StoredAccount } from '../../services/AccountStorageService';
import { KeySignerClient, type KeySignerAccount } from '../../services/KeySignerClient';
import { KeySignerPasswordModal } from '../modals/KeySignerPasswordModal';
import { EventBus } from '../../services/EventBus';

export interface AccountSwitcherOptions {
  npub: string;
  pubkey: string;
  onLogout?: () => void;
  onAddAccount?: () => void;
}

interface DisplayAccount {
  pubkey: string;
  npub: string;
  displayName?: string;
  authMethod?: string;
}

export class AccountSwitcher {
  private element: HTMLElement;
  private dropdown: HTMLElement | null = null;
  private isOpen: boolean = false;
  private userProfileService: UserProfileService;
  private authService: AuthService;
  private accountStorage: AccountStorageService;
  private keySignerClient: KeySignerClient;
  private eventBus: EventBus;
  private options: AccountSwitcherOptions;
  private profile: UserProfile | null = null;
  private unsubscribeProfile?: () => void;
  private clickOutsideHandler: (e: MouseEvent) => void;
  private keySignerAccounts: KeySignerAccount[] = [];
  private profileCache: Map<string, UserProfile> = new Map();

  constructor(options: AccountSwitcherOptions) {
    this.userProfileService = UserProfileService.getInstance();
    this.authService = AuthService.getInstance();
    this.accountStorage = AccountStorageService.getInstance();
    this.keySignerClient = KeySignerClient.getInstance();
    this.eventBus = EventBus.getInstance();
    this.options = options;
    this.element = this.createElement();
    this.loadProfile();

    // Click outside handler
    this.clickOutsideHandler = (e: MouseEvent) => {
      if (this.isOpen && !this.element.contains(e.target as Node)) {
        this.closeDropdown();
      }
    };
    document.addEventListener('click', this.clickOutsideHandler);
  }

  /**
   * Create account switcher element
   */
  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'account-switcher';
    container.innerHTML = `
      <button class="account-switcher__trigger" type="button">
        <div class="account-switcher__current">
          <span class="account-switcher__indicator"></span>
          <span class="account-switcher__name">Loading...</span>
        </div>
        <span class="account-switcher__arrow">&#9662;</span>
      </button>
    `;

    // Setup trigger click
    const trigger = container.querySelector('.account-switcher__trigger');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });
    }

    return container;
  }

  /**
   * Load user profile and update display
   */
  private async loadProfile(): Promise<void> {
    // Subscribe to profile updates
    this.unsubscribeProfile = this.userProfileService.subscribeToProfile(
      this.options.pubkey,
      (profile: UserProfile) => {
        this.profile = profile;
        this.profileCache.set(this.options.pubkey, profile);
        this.updateDisplay();

        // Also update account storage with profile info
        this.accountStorage.updateAccount(this.options.pubkey, {
          displayName: profile.name || profile.display_name,
          avatarUrl: profile.picture
        });
      }
    );

    // Trigger initial load
    try {
      await this.userProfileService.getUserProfile(this.options.pubkey);
    } catch (error) {
      console.warn(`[AccountSwitcher] Failed to load profile: ${this.options.pubkey}`, error);
      this.showFallback();
    }
  }

  /**
   * Update display with loaded profile
   */
  private updateDisplay(): void {
    const nameEl = this.element.querySelector('.account-switcher__name');
    if (nameEl) {
      const displayName = this.profile?.name || this.profile?.display_name || `${this.options.npub.slice(0, 12)}...`;
      nameEl.textContent = displayName;
    }
  }

  /**
   * Show fallback when profile loading fails
   */
  private showFallback(): void {
    const nameEl = this.element.querySelector('.account-switcher__name');
    if (nameEl) {
      nameEl.textContent = `${this.options.npub.slice(0, 12)}...`;
    }
  }

  /**
   * Toggle dropdown visibility
   */
  private toggleDropdown(): void {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  /**
   * Open dropdown
   */
  private async openDropdown(): Promise<void> {
    if (this.isOpen) return;

    this.isOpen = true;
    this.element.classList.add('account-switcher--open');

    // Show loading state
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'account-switcher__dropdown';
    this.dropdown.innerHTML = '<div class="account-switcher__loading">Loading...</div>';
    this.element.appendChild(this.dropdown);

    // Fetch accounts and update dropdown
    await this.populateDropdown();
  }

  /**
   * Close dropdown
   */
  private closeDropdown(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
    this.element.classList.remove('account-switcher--open');
  }

  /**
   * Populate dropdown with accounts
   */
  private async populateDropdown(): Promise<void> {
    if (!this.dropdown) return;

    const authMethod = this.authService.getAuthMethod();
    let accounts: DisplayAccount[] = [];

    // Fetch accounts based on auth method
    if (authMethod === 'key-signer') {
      try {
        const result = await this.keySignerClient.listAccounts();
        this.keySignerAccounts = result.accounts;
        accounts = result.accounts.map(acc => ({
          pubkey: acc.pubkey,
          npub: acc.npub,
          authMethod: 'key-signer'
        }));

        // Load profiles for all accounts
        await this.loadAccountProfiles(accounts);
      } catch (error) {
        console.error('[AccountSwitcher] Failed to list KeySigner accounts:', error);
      }
    } else {
      // Use local account storage for nsec/extension accounts
      const stored = this.accountStorage.getAccounts();
      accounts = stored.map(acc => ({
        pubkey: acc.pubkey,
        npub: acc.npub,
        displayName: acc.displayName,
        authMethod: acc.authMethod
      }));
    }

    // Build dropdown content
    this.dropdown.innerHTML = '';
    const currentPubkey = this.options.pubkey;

    // Account list section (only if more than 1 account)
    if (accounts.length > 1) {
      const accountsSection = document.createElement('div');
      accountsSection.className = 'account-switcher__section';
      accountsSection.innerHTML = `<div class="account-switcher__section-title">Switch Account</div>`;

      const accountsList = document.createElement('div');
      accountsList.className = 'account-switcher__accounts';

      for (const account of accounts) {
        const isActive = account.pubkey === currentPubkey;
        const item = this.createAccountItem(account, isActive, authMethod === 'key-signer');
        accountsList.appendChild(item);
      }

      accountsSection.appendChild(accountsList);
      this.dropdown.appendChild(accountsSection);
    }

    // Actions section
    const actionsSection = document.createElement('div');
    actionsSection.className = 'account-switcher__section account-switcher__actions';

    // Add account button (only for non-KeySigner or if KeySigner supports it)
    if (authMethod !== 'key-signer') {
      const addBtn = document.createElement('button');
      addBtn.className = 'account-switcher__action';
      addBtn.innerHTML = `<span class="account-switcher__action-icon">+</span> Add account`;
      addBtn.addEventListener('click', () => this.handleAddAccount());
      actionsSection.appendChild(addBtn);

      // Divider
      const divider = document.createElement('div');
      divider.className = 'account-switcher__divider';
      actionsSection.appendChild(divider);
    }

    // Logout current
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'account-switcher__action account-switcher__action--danger';
    logoutBtn.innerHTML = `<span class="account-switcher__action-icon">&larr;</span> Sign out`;
    logoutBtn.addEventListener('click', () => this.handleLogout());
    actionsSection.appendChild(logoutBtn);

    this.dropdown.appendChild(actionsSection);
  }

  /**
   * Load profiles for accounts
   */
  private async loadAccountProfiles(accounts: DisplayAccount[]): Promise<void> {
    const promises = accounts.map(async (account) => {
      if (this.profileCache.has(account.pubkey)) {
        account.displayName = this.getDisplayName(this.profileCache.get(account.pubkey)!);
        return;
      }

      try {
        const profile = await this.userProfileService.getUserProfile(account.pubkey);
        if (profile) {
          this.profileCache.set(account.pubkey, profile);
          account.displayName = this.getDisplayName(profile);
        }
      } catch {
        // Profile load failed, use npub fallback
      }
    });

    await Promise.all(promises);
  }

  /**
   * Get display name from profile
   */
  private getDisplayName(profile: UserProfile): string {
    return profile.name || profile.display_name || '';
  }

  /**
   * Create account item element
   */
  private createAccountItem(account: DisplayAccount, isActive: boolean, isKeySigner: boolean): HTMLElement {
    const item = document.createElement('button');
    item.className = `account-switcher__account${isActive ? ' account-switcher__account--active' : ''}`;

    const displayName = account.displayName || `${account.npub.slice(0, 12)}...`;

    item.innerHTML = `
      <span class="account-switcher__account-name">${displayName}</span>
      ${isActive ? '<span class="account-switcher__active-dot"></span>' : ''}
    `;

    if (!isActive) {
      item.addEventListener('click', () => {
        if (isKeySigner) {
          this.handleKeySignerSwitch(account);
        } else {
          this.handleSwitch(account.pubkey);
        }
      });
    }

    return item;
  }

  /**
   * Handle KeySigner account switch (requires password)
   */
  private handleKeySignerSwitch(account: DisplayAccount): void {
    this.closeDropdown();

    const modal = new KeySignerPasswordModal({
      npub: account.npub,
      displayName: account.displayName,
      onSuccess: async () => {
        // NoorSigner has switched accounts - now re-authenticate to update AuthService
        // This will get the new pubkey from daemon and emit user:login
        await this.authService.authenticateWithKeySigner();
      }
    });

    modal.show();
  }

  /**
   * Handle local account switch
   */
  private async handleSwitch(pubkey: string): Promise<void> {
    this.closeDropdown();

    const result = await this.authService.switchAccount(pubkey);
    if (!result.success) {
      console.error('[AccountSwitcher] Switch failed:', result.error);
    }
  }

  /**
   * Handle add account
   */
  private handleAddAccount(): void {
    this.closeDropdown();

    if (this.options.onAddAccount) {
      this.options.onAddAccount();
    }
  }

  /**
   * Handle logout current account
   */
  private handleLogout(): void {
    this.closeDropdown();

    if (this.options.onLogout) {
      this.options.onLogout();
    }
  }

  /**
   * Update user options (when switching accounts)
   */
  public updateUser(options: AccountSwitcherOptions): void {
    if (this.unsubscribeProfile) {
      this.unsubscribeProfile();
    }

    this.options = options;
    this.profile = null;
    this.loadProfile();
    this.closeDropdown();
  }

  /**
   * Get DOM element
   */
  public getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.unsubscribeProfile) {
      this.unsubscribeProfile();
    }
    document.removeEventListener('click', this.clickOutsideHandler);
    this.closeDropdown();
    this.element.remove();
  }
}
