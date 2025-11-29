/**
 * Authentication Component
 * Handles login/logout UI and authentication flow
 */

import { AuthService } from '../../services/AuthService';
import { SystemLogger } from '../system/SystemLogger';
import { Router } from '../../services/Router';
import { EventBus } from '../../services/EventBus';
import { PlatformService } from '../../services/PlatformService';

// Forward declaration to avoid circular dependency
interface MainLayoutInterface {
  setUserStatus(npub: string, pubkey: string): void;
  clearUserStatus(): void;
}

export class AuthComponent {
  private element: HTMLElement;
  private authService: AuthService;
  private systemLogger: SystemLogger;
  private router: Router;
  private eventBus: EventBus;
  private mainLayout: MainLayoutInterface | null = null;
  private currentUser: { npub: string; pubkey: string } | null = null;

  constructor(mainLayout?: MainLayoutInterface) {
    this.authService = AuthService.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.router = Router.getInstance();
    this.eventBus = EventBus.getInstance();
    this.mainLayout = mainLayout || null;

    // Check session BEFORE creating UI
    this.currentUser = this.authService.getCurrentUser();

    this.element = this.createElement();
    this.setupEventListeners();

    // Async session restore after UI is ready
    this.checkExistingSession();
  }

  /**
   * Create the authentication component UI
   */
  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'auth-component';

    if (this.currentUser) {
      // User is authenticated - show nothing (UserStatus shows username + logout)
      container.innerHTML = '';
    } else {
      // User not authenticated - show login button
      container.innerHTML = `
        <div class="user-status">
          <div class="user-info">
            <span class="user-indicator">○</span>
            <span class="user-display">Not logged in</span>
          </div>
          <button class="btn btn--mini" type="button" data-action="show-login">Login</button>
        </div>
      `;
    }

    return container;
  }

  /**
   * Setup event listeners for authentication actions
   */
  private setupEventListeners(): void {
    const showLoginBtn = this.element.querySelector('[data-action="show-login"]');
    if (showLoginBtn) {
      showLoginBtn.addEventListener('click', () => this.router.navigate('/login'));
    }
  }

  /**
   * Show login screen in primary-content
   * Browser: NIP-07 Extension prominent
   * Tauri: NoorSigner prominent
   */
  public showLoginScreen(): void {
    const primaryContent = document.querySelector('.primary-content');
    if (!primaryContent) return;

    const platform = PlatformService.getInstance();

    // Primary login option based on platform
    let primaryLoginOption: string;

    if (platform.isTauri) {
      // Tauri: NoorSigner prominent
      primaryLoginOption = `
        <section class="auth-section auth-section--primary">
          <div class="auth-primary-action">
            <button class="btn btn--large" data-action="use-key-signer">
              🔑 Use NoorSigner
            </button>
            <p class="auth-hint">Secure local key signer</p>
          </div>
        </section>
      `;
    } else {
      // Browser: NIP-07 Extension prominent
      const extensionAvailable = this.authService.isExtensionAvailable();
      const extensionName = this.authService.getExtensionName();

      primaryLoginOption = extensionAvailable
        ? `
          <section class="auth-section auth-section--primary">
            <div class="auth-primary-action">
              <button class="btn btn--large" data-action="use-extension">
                🔐 Login with ${extensionName}
              </button>
              <p class="auth-hint">Sign with your browser extension</p>
            </div>
          </section>
        `
        : `
          <section class="auth-section auth-section--primary">
            <div class="auth-primary-action auth-primary-action--disabled">
              <button class="btn btn--large" disabled>
                🔐 No Extension Found
              </button>
              <p class="auth-hint">
                Install <a href="https://getalby.com" target="_blank">Alby</a>,
                <a href="https://github.com/nicbus/nos2x" target="_blank">nos2x</a>, or another
                <a href="https://github.com/nicbus/nos2x/blob/master/README.md" target="_blank">NIP-07</a> extension
              </p>
            </div>
          </section>
        `;
    }

    primaryContent.innerHTML = `
      <div class="auth-login-card">
        <h1>Welcome to NoorNote</h1>

        ${primaryLoginOption}

        <div class="auth-divider">
          <span>or</span>
        </div>

        <section class="auth-section">
          <h2>Remote Signer</h2>
          <div class="auth-input-group">
            <input
              type="text"
              class="auth-input"
              placeholder="bunker://..."
              data-input="bunker"
              autocomplete="off"
            />
            <button class="btn" data-action="connect-bunker">Connect</button>
          </div>
          <p class="auth-hint">NIP-46 remote signer (nsecBunker, etc.)</p>
        </section>

        <section class="auth-section">
          <h2>View Only</h2>
          <div class="auth-input-group">
            <input
              type="text"
              class="auth-input"
              placeholder="npub1..."
              data-input="npub"
              autocomplete="off"
            />
            <button class="btn" data-action="view-only">View</button>
          </div>
          <p class="auth-hint">Browse without signing capabilities</p>
        </section>

        <section class="auth-section">
          <h2>Create New Account</h2>
          <div class="auth-create">
            <button class="btn btn--accent" data-action="create-account">Create New Account</button>
          </div>
        </section>
      </div>
    `;

    // Setup event listeners for injected UI
    this.setupLoginViewListeners();
  }

  /**
   * Setup listeners for login view
   */
  private setupLoginViewListeners(): void {
    const primaryContent = document.querySelector('.primary-content');
    if (!primaryContent) return;

    // NIP-07 Extension button (Browser)
    const extensionBtn = primaryContent.querySelector('[data-action="use-extension"]');
    if (extensionBtn) {
      extensionBtn.addEventListener('click', this.handleExtensionLogin.bind(this));
    }

    // KeySigner button (Tauri)
    const keySignerBtn = primaryContent.querySelector('[data-action="use-key-signer"]');
    if (keySignerBtn) {
      keySignerBtn.addEventListener('click', this.handleKeySignerLogin.bind(this));
    }

    // Bunker connect button
    const bunkerBtn = primaryContent.querySelector('[data-action="connect-bunker"]');
    if (bunkerBtn) {
      bunkerBtn.addEventListener('click', this.handleBunkerLogin.bind(this));
    }

    // View only button (npub)
    const viewOnlyBtn = primaryContent.querySelector('[data-action="view-only"]');
    if (viewOnlyBtn) {
      viewOnlyBtn.addEventListener('click', this.handleNpubLogin.bind(this));
    }

    // Create account button
    const createAccountBtn = primaryContent.querySelector('[data-action="create-account"]');
    if (createAccountBtn) {
      createAccountBtn.addEventListener('click', this.handleCreateAccount.bind(this));
    }

    // Enter key support for bunker input
    const bunkerInput = primaryContent.querySelector('[data-input="bunker"]');
    if (bunkerInput) {
      bunkerInput.addEventListener('keypress', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          this.handleBunkerLogin();
        }
      });
    }

    // Enter key support for npub input
    const npubInput = primaryContent.querySelector('[data-input="npub"]');
    if (npubInput) {
      npubInput.addEventListener('keypress', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          this.handleNpubLogin();
        }
      });
    }
  }

  /**
   * Handle KeySigner login
   */
  private async handleKeySignerLogin(): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    const keySignerBtn = primaryContent?.querySelector('[data-action="use-key-signer"]') as HTMLButtonElement;

    if (!keySignerBtn) return;

    keySignerBtn.disabled = true;
    keySignerBtn.textContent = 'Launching daemon...';

    // Add cancel button
    const authSection = keySignerBtn.closest('.auth-section');
    let cancelBtn: HTMLButtonElement | null = null;

    if (authSection) {
      cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn--passive';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.marginTop = '0.5rem';
      cancelBtn.setAttribute('data-action', 'cancel-keysigner');
      authSection.querySelector('.auth-primary-action')?.appendChild(cancelBtn);
    }

    // Flag to track if user cancelled
    let userCancelled = false;

    // Cancel button handler
    const handleCancel = async () => {
      userCancelled = true;
      await this.authService.cancelKeySignerLogin(); // Abort polling loop + close terminal
      keySignerBtn.disabled = false;
      keySignerBtn.textContent = '🔑 Use NoorSigner';
      cancelBtn?.remove();
    };

    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }

    try {
      // Show waiting message
      setTimeout(() => {
        if (keySignerBtn.textContent === 'Launching daemon...' && !userCancelled) {
          keySignerBtn.textContent = '⏳ Waiting for password...';
        }
      }, 2000);

      const result = await this.authService.authenticateWithKeySigner();

      // Remove cancel button after completion
      cancelBtn?.remove();

      if (userCancelled) {
        // User cancelled - do nothing
        return;
      }

      if (result.success && result.npub && result.pubkey) {
        this.currentUser = { npub: result.npub, pubkey: result.pubkey };
        this.systemLogger.info('Auth', 'Logged in successfully via KeySigner');

        if (this.mainLayout) {
          this.mainLayout.setUserStatus(result.npub, result.pubkey);
        }

        this.updateUI();

        // Navigate to timeline (AuthService already emitted user:login event)
        this.router.navigate('/');
      } else {
        this.systemLogger.error('Auth', 'KeySigner login failed');
        this.showError(result.error || 'KeySigner authentication failed');
        keySignerBtn.disabled = false;
        keySignerBtn.textContent = '🔑 Use NoorSigner';
      }
    } catch (error) {
      console.error('KeySigner login error:', error);
      this.showError('Unexpected error during KeySigner authentication');
      keySignerBtn.disabled = false;
      keySignerBtn.textContent = '🔑 Use NoorSigner';
      cancelBtn?.remove();
    }
  }

  /**
   * Handle NIP-07 Extension login
   */
  private async handleExtensionLogin(): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    const extensionBtn = primaryContent?.querySelector('[data-action="use-extension"]') as HTMLButtonElement;

    if (!extensionBtn) return;

    extensionBtn.disabled = true;
    extensionBtn.textContent = 'Connecting...';

    try {
      const result = await this.authService.authenticateWithExtension();

      if (result.success && result.npub && result.pubkey) {
        this.currentUser = { npub: result.npub, pubkey: result.pubkey };
        this.systemLogger.info('Auth', 'Logged in successfully via NIP-07 Extension');

        if (this.mainLayout) {
          this.mainLayout.setUserStatus(result.npub, result.pubkey);
        }

        this.updateUI();
        this.router.navigate('/');
      } else {
        this.systemLogger.error('Auth', 'Extension login failed');
        this.showError(result.error || 'Extension authentication failed');
        extensionBtn.disabled = false;
        extensionBtn.textContent = '🔐 Login with Extension';
      }
    } catch (error) {
      console.error('Extension login error:', error);
      this.showError('Unexpected error during extension authentication');
      extensionBtn.disabled = false;
      extensionBtn.textContent = '🔐 Login with Extension';
    }
  }

  /**
   * Handle bunker:// login (NIP-46)
   */
  private async handleBunkerLogin(): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    const bunkerInput = primaryContent?.querySelector('[data-input="bunker"]') as HTMLInputElement;
    const bunkerBtn = primaryContent?.querySelector('[data-action="connect-bunker"]') as HTMLButtonElement;

    if (!bunkerInput || !bunkerBtn) return;

    const bunkerUri = bunkerInput.value.trim();
    if (!bunkerUri) {
      this.showError('Please enter a bunker:// URI');
      return;
    }

    if (!bunkerUri.startsWith('bunker://')) {
      this.showError('Invalid bunker URI. Must start with bunker://');
      return;
    }

    bunkerBtn.disabled = true;
    bunkerBtn.textContent = 'Connecting...';

    try {
      const result = await this.authService.authenticateWithInput(bunkerUri);

      if (result.success && result.npub && result.pubkey) {
        this.currentUser = { npub: result.npub, pubkey: result.pubkey };
        this.systemLogger.info('Auth', 'Logged in successfully via NIP-46 bunker');

        if (this.mainLayout) {
          this.mainLayout.setUserStatus(result.npub, result.pubkey);
        }

        this.updateUI();
        this.router.navigate('/');
      } else {
        this.systemLogger.error('Auth', 'Bunker login failed');
        this.showError(result.error || 'Bunker connection failed');
        bunkerBtn.disabled = false;
        bunkerBtn.textContent = 'Connect';
      }
    } catch (error) {
      console.error('Bunker login error:', error);
      this.showError('Unexpected error during bunker connection');
      bunkerBtn.disabled = false;
      bunkerBtn.textContent = 'Connect';
    }
  }

  /**
   * Handle npub login (read-only mode)
   */
  private async handleNpubLogin(): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    const npubInput = primaryContent?.querySelector('[data-input="npub"]') as HTMLInputElement;
    const viewOnlyBtn = primaryContent?.querySelector('[data-action="view-only"]') as HTMLButtonElement;

    if (!npubInput || !viewOnlyBtn) return;

    const npub = npubInput.value.trim();
    if (!npub) {
      this.showError('Please enter an npub');
      return;
    }

    if (!npub.startsWith('npub1')) {
      this.showError('Invalid npub. Must start with npub1');
      return;
    }

    viewOnlyBtn.disabled = true;
    viewOnlyBtn.textContent = 'Loading...';

    try {
      const result = await this.authService.authenticateWithInput(npub);

      if (result.success && result.npub && result.pubkey) {
        this.currentUser = { npub: result.npub, pubkey: result.pubkey };
        this.systemLogger.info('Auth', 'Logged in successfully via npub (read-only)');

        if (this.mainLayout) {
          this.mainLayout.setUserStatus(result.npub, result.pubkey);
        }

        this.updateUI();
        this.router.navigate('/');

        // Show read-only notice
        this.showError('✓ Read-only mode. You can browse but not post/like/zap.');
      } else {
        this.systemLogger.error('Auth', 'npub login failed');
        this.showError(result.error || 'Failed to load profile');
        viewOnlyBtn.disabled = false;
        viewOnlyBtn.textContent = 'View';
      }
    } catch (error) {
      console.error('npub login error:', error);
      this.showError('Unexpected error during profile load');
      viewOnlyBtn.disabled = false;
      viewOnlyBtn.textContent = 'View';
    }
  }

  /**
   * Handle smart login (auto-detects input type) - Legacy fallback
   */
  private async handleSmartLogin(): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    const authInput = primaryContent?.querySelector('.auth-input') as HTMLInputElement;
    const smartLoginBtn = primaryContent?.querySelector('[data-action="smart-login"]') as HTMLButtonElement;

    if (!authInput || !smartLoginBtn) return;

    const input = authInput.value.trim();
    if (!input) {
      this.showError('Please enter your npub or nsec');
      return;
    }

    smartLoginBtn.disabled = true;
    smartLoginBtn.textContent = 'Adding...';

    try {
      const result = await this.authService.authenticateWithInput(input);

      if (result.success && result.npub && result.pubkey) {
        this.currentUser = { npub: result.npub, pubkey: result.pubkey };
        const loginType = result.readOnly ? 'npub (read-only)' : 'nsec';
        this.systemLogger.info('Auth', `Logged in successfully via ${loginType}`);

        if (this.mainLayout) {
          this.mainLayout.setUserStatus(result.npub, result.pubkey);
        }

        this.updateUI();

        // Navigate to timeline (AuthService already emitted user:login event)
        this.router.navigate('/');

        // Show read-only notice if npub login
        if (result.readOnly) {
          this.showError('✓ Read-only mode (npub). You can browse but not post/like/zap.');
        }
      } else {
        this.systemLogger.error('Auth', 'Smart login failed');
        this.showError(result.error || 'Authentication failed');
        smartLoginBtn.disabled = false;
        smartLoginBtn.textContent = 'Add';
      }
    } catch (error) {
      console.error('Smart login error:', error);
      this.showError('Unexpected error during authentication');
      smartLoginBtn.disabled = false;
      smartLoginBtn.textContent = 'Add';
    }
  }

  /**
   * Handle logout
   */
  public async handleLogout(): Promise<void> {
    await this.authService.signOut();
    this.currentUser = null;

    // Update own UI first (before MainLayout clears)
    this.updateUI();

    // Clear main layout user status (will re-mount this component)
    if (this.mainLayout) {
      this.mainLayout.clearUserStatus();
    }

    // Note: AuthService.signOut() already emits 'user:logout' event
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    const existingError = this.element.querySelector('.auth-error');
    if (existingError) {
      existingError.remove();
    }

    const errorElement = document.createElement('div');
    errorElement.className = 'auth-error';
    errorElement.innerHTML = `
      <p class="error">${message}</p>
    `;

    this.element.appendChild(errorElement);

    // Remove error after 5 seconds
    setTimeout(() => {
      if (errorElement.parentNode) {
        errorElement.remove();
      }
    }, 5000);
  }

  /**
   * Update the UI based on current authentication state
   */
  private updateUI(): void {
    const newElement = this.createElement();
    this.element.parentNode?.replaceChild(newElement, this.element);
    this.element = newElement;
    this.setupEventListeners();
  }

  /**
   * Get the DOM element
   */
  public getElement(): HTMLElement {
    return this.element;
  }


  /**
   * Check for existing session on component initialization
   */
  private async checkExistingSession(): Promise<void> {
    if (this.authService.hasValidSession()) {
      const currentUser = this.authService.getCurrentUser();
      if (currentUser) {
        this.systemLogger.info('Auth', 'Found existing session, attempting to restore');

        // Set user status immediately (before extension restore)
        this.currentUser = currentUser;
        if (this.mainLayout) {
          this.mainLayout.setUserStatus(currentUser.npub, currentUser.pubkey);
        }

        // Try to restore extension connection (async, may fail if extension not loaded yet)
        const restored = await this.authService.restoreExtensionConnection();

        if (restored) {
          this.systemLogger.info('Auth', 'Key signer connection: restored');
        } else {
          this.systemLogger.info('Auth', 'Key signer not available yet');
        }

        this.updateUI();

        // Reload current route to show Timeline
        this.router.navigate(window.location.pathname);
      }
    }
  }

  /**
   * Handle create new account
   */
  private async handleCreateAccount(): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    const createAccountBtn = primaryContent?.querySelector('[data-action="create-account"]') as HTMLButtonElement;
    if (!createAccountBtn) return;

    createAccountBtn.disabled = true;
    createAccountBtn.textContent = 'Generating...';

    try {
      // Import from nostr-tools
      const { generatePrivateKey, getPublicKey } = await import('nostr-tools');

      // Generate new keypair
      const privateKey = generatePrivateKey();
      const pubkey = getPublicKey(privateKey);

      // Convert to nsec/npub format
      const { hexToNsec, hexToNpub } = await import('../../helpers/nip19');

      const nsec = hexToNsec(privateKey);
      const npub = hexToNpub(pubkey);

      // Show generated keys to user
      primaryContent!.innerHTML = `
        <div class="auth-login-card">
          <h2>🎉 New Account Created!</h2>
          <p><strong>IMPORTANT: Save these keys immediately!</strong></p>

          <div class="auth-keys-display">
            <div class="auth-key-item">
              <label>Public Key (npub) - Share this:</label>
              <input type="text" readonly value="${npub}" class="auth-key-input" data-key="npub" />
              <button class="btn btn--mini" data-action="copy-npub">Copy</button>
            </div>

            <div class="auth-key-item auth-key-item--critical">
              <label>Private Key (nsec) - NEVER share this:</label>
              <input type="text" readonly value="${nsec}" class="auth-key-input" data-key="nsec" />
              <button class="btn btn--mini" data-action="copy-nsec">Copy</button>
            </div>
          </div>

          <p class="auth-warning">
            ⚠️ <strong>Write down your private key (nsec) NOW!</strong><br>
            Without it, you'll lose access to your account forever. There's no recovery option.
          </p>

          <button class="btn" data-action="continue-with-keys" data-nsec="${nsec}">
            I've Saved My Keys - Continue
          </button>
          <button class="btn btn--secondary" data-action="back-to-login">Cancel</button>
        </div>
      `;

      // Setup listeners for new view
      this.setupKeyDisplayListeners();

    } catch (error) {
      console.error('Key generation error:', error);
      this.showError('Failed to generate keys');
      createAccountBtn.disabled = false;
      createAccountBtn.textContent = 'Generate New Keys';
    }
  }

  /**
   * Setup listeners for key display view
   */
  private setupKeyDisplayListeners(): void {
    const primaryContent = document.querySelector('.primary-content');
    if (!primaryContent) return;

    // Copy npub
    const copyNpubBtn = primaryContent.querySelector('[data-action="copy-npub"]');
    if (copyNpubBtn) {
      copyNpubBtn.addEventListener('click', () => {
        const npubInput = primaryContent.querySelector('[data-key="npub"]') as HTMLInputElement;
        npubInput.select();
        document.execCommand('copy');
        (copyNpubBtn as HTMLButtonElement).textContent = 'Copied!';
        setTimeout(() => (copyNpubBtn as HTMLButtonElement).textContent = 'Copy', 2000);
      });
    }

    // Copy nsec
    const copyNsecBtn = primaryContent.querySelector('[data-action="copy-nsec"]');
    if (copyNsecBtn) {
      copyNsecBtn.addEventListener('click', () => {
        const nsecInput = primaryContent.querySelector('[data-key="nsec"]') as HTMLInputElement;
        nsecInput.select();
        document.execCommand('copy');
        (copyNsecBtn as HTMLButtonElement).textContent = 'Copied!';
        setTimeout(() => (copyNsecBtn as HTMLButtonElement).textContent = 'Copy', 2000);
      });
    }

    // Continue with keys (auto-login)
    const continueBtn = primaryContent.querySelector('[data-action="continue-with-keys"]');
    if (continueBtn) {
      continueBtn.addEventListener('click', async () => {
        const nsec = continueBtn.getAttribute('data-nsec');
        if (nsec) {
          // Auto-login with generated nsec
          const result = await this.authService.authenticateWithNsec(nsec);
          if (result.success && result.npub && result.pubkey) {
            this.currentUser = { npub: result.npub, pubkey: result.pubkey };
            this.systemLogger.info('Auth', 'Logged in with newly generated keys');

            if (this.mainLayout) {
              this.mainLayout.setUserStatus(result.npub, result.pubkey);
            }

            this.updateUI();

            // Navigate to timeline (AuthService already emitted user:login event)
            this.router.navigate('/timeline');
          }
        }
      });
    }

    // Back to login
    const backBtn = primaryContent.querySelector('[data-action="back-to-login"]');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.router.navigate('/login');
      });
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.element.remove();
  }
}