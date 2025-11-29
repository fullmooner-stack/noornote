/**
 * Main Application Class
 * Coordinates all application modules and manages the application lifecycle
 */

import { MainLayout } from './components/layout/MainLayout';
import { Router } from './services/Router';
import { AppState } from './services/AppState';
import { SingleNoteView } from './components/views/SingleNoteView';
import { ProfileView } from './components/views/ProfileView';
import { ArticleView } from './components/views/ArticleView';
import { SettingsView } from './components/views/SettingsView';
import { Timeline } from './components/timeline/Timeline';
import { AuthService } from './services/AuthService';
import { SystemLogger } from './components/system/SystemLogger';
import { EventBus } from './services/EventBus';
import { ViewLifecycleManager } from './services/ViewLifecycleManager';
import { KeySignerClient } from './services/KeySignerClient';
import { ModalService } from './services/ModalService';
import { PlatformService } from './services/PlatformService';
import { ConnectivityService } from './services/ConnectivityService';
import { OfflineOverlay } from './components/system/OfflineOverlay';
import type { View } from './components/views/View';

export class App {
  private appElement: HTMLElement | null = null;

  // Layout Component
  private mainLayout: MainLayout | null = null;

  // Core Services
  private router: Router;
  private appState: AppState;
  private authService: AuthService;
  private eventBus: EventBus;
  private systemLogger: SystemLogger;
  private viewLifecycleManager: ViewLifecycleManager;

  // View Components (reused instances)
  private timelineUI: Timeline | null = null;
  private profileView: ProfileView | null = null;

  constructor() {
    this.appElement = document.getElementById('app');
    if (!this.appElement) {
      throw new Error('App element not found');
    }

    // Initialize Core Services (Singletons)
    this.router = Router.getInstance();
    this.appState = AppState.getInstance();
    this.authService = AuthService.getInstance();
    this.eventBus = EventBus.getInstance();
    this.systemLogger = SystemLogger.getInstance();
    this.viewLifecycleManager = ViewLifecycleManager.getInstance();
  }

  async initialize(): Promise<void> {
    this.setupRoutes();
    this.setupUI();
    this.setupEventListeners();

    // Check internet connectivity before proceeding
    const connectivityService = ConnectivityService.getInstance();
    const isOnline = await connectivityService.checkConnectivity();

    if (!isOnline) {
      // Show offline overlay and stop initialization
      const offlineOverlay = OfflineOverlay.getInstance();
      offlineOverlay.show();
      return;
    }

    // Capture last URL BEFORE auth (to preserve it before auto-login overwrites it)
    const lastURL = this.router.getLastURL();

    // Wait for auth initialization before navigating to preserve current route on reload
    await this.waitForAuthReady();

    const isLoggedIn = this.authService.hasValidSession();

    // Determine target path: prioritize lastURL (reload case), fallback to login or timeline
    let targetPath: string;
    if (!isLoggedIn) {
      targetPath = '/login';
    } else if (lastURL && lastURL !== '/login') {
      targetPath = lastURL; // Restore last visited page
    } else {
      targetPath = '/'; // Default to timeline
    }

    this.router.navigate(targetPath);

    // Set focus to enable keyboard shortcuts immediately after app load
    // Without this, keyboard events won't fire until user clicks somewhere
    this.setInitialFocus();
  }

  /**
   * Set initial focus for Tauri window to enable keyboard shortcuts
   */
  private async setInitialFocus(): Promise<void> {
    try {
      // Try to focus Tauri window
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const window = getCurrentWindow();
      await window.setFocus();
    } catch (error) {
      // Fallback for non-Tauri environments (browser)
      setTimeout(() => {
        document.body.focus();
        document.body.tabIndex = -1;
      }, 100);
    }
  }

  /**
   * Wait for auth to be ready (either logged in or confirmed not logged in)
   */
  private waitForAuthReady(): Promise<void> {
    return new Promise((resolve) => {
      // If already logged in, resolve immediately
      if (this.authService.hasValidSession()) {
        resolve();
        return;
      }

      // Otherwise wait for login event or timeout
      const timeout = setTimeout(() => {
        this.eventBus.off(subscriptionId);
        resolve();
      }, 1000); // 1 second timeout for auto-login

      const subscriptionId = this.eventBus.on('user:login', () => {
        clearTimeout(timeout);
        this.eventBus.off(subscriptionId);
        resolve();
      });
    });
  }

  private setupRoutes(): void {
    // Login/Welcome Screen (public route)
    this.router.register(
      '/login',
      () => {
        this.appState.setState('view', { currentView: 'login' });
        this.mountPrimaryContent('not-logged-in');
        this.mountSecondaryContent('debug-log');
      },
      'login-view'
    );

    // Timeline View (requires authentication)
    this.router.register(
      '/',
      () => {
        this.appState.setState('view', { currentView: 'timeline' });
        this.mountPrimaryContent('timeline');
        this.mountSecondaryContent('debug-log');
      },
      'tv',
      true // requiresAuth
    );

    this.router.register('/note/:noteId', (params) => {
      this.systemLogger.info('Router', 'Single Note View ready');
      this.appState.setState('view', {
        currentView: 'single-note',
        currentNoteId: params.noteId
      });
      this.mountPrimaryContent('single-note', params.noteId);
      this.mountSecondaryContent('debug-log');
    }, 'snv');

    // Profile View route
    this.router.register('/profile/:npub', (params) => {
      this.appState.setState('view', {
        currentView: 'profile',
        currentProfileNpub: params.npub
      });
      this.mountPrimaryContent('profile', params.npub);
      this.mountSecondaryContent('debug-log');
    }, 'pv');

    // Article View route
    this.router.register('/article/:naddr', (params) => {
      this.appState.setState('view', {
        currentView: 'article',
        currentArticleNaddr: params.naddr
      });
      this.mountPrimaryContent('article', params.naddr);
      this.mountSecondaryContent('debug-log');
    }, 'av');

    this.router.register(
      '/notifications',
      () => {
        this.appState.setState('view', {
          currentView: 'notifications'
        });
        this.mountPrimaryContent('notifications');
        this.mountSecondaryContent('debug-log');
      },
      'nv',
      true
    );

    this.router.register(
      '/settings',
      () => {
        this.appState.setState('view', {
          currentView: 'settings'
        });
        this.mountPrimaryContent('settings');
        this.mountSecondaryContent('debug-log');
      },
      'sv',
      true
    );

    // Write Article View (requires authentication)
    this.router.register(
      '/write-article',
      () => {
        this.appState.setState('view', {
          currentView: 'write-article'
        });
        this.mountPrimaryContent('write-article');
        this.mountSecondaryContent('debug-log');
      },
      'aev', // Article Editor View
      true
    );

    // Articles Timeline View
    this.router.register(
      '/articles',
      () => {
        this.appState.setState('view', {
          currentView: 'articles'
        });
        this.mountPrimaryContent('articles');
        this.mountSecondaryContent('debug-log');
      },
      'atv', // Article Timeline View
      false // No auth required to view
    );

  }

  private async mountPrimaryContent(viewType: string, param?: string): Promise<void> {
    const primaryContent = document.querySelector('.primary-content');
    if (!primaryContent) return;

    // Unmount existing views via ViewLifecycleManager
    if (this.timelineUI && this.viewLifecycleManager.isViewMounted(this.timelineUI, primaryContent)) {
      this.viewLifecycleManager.onViewUnmount(this.timelineUI);
    }

    if (this.profileView && this.viewLifecycleManager.isViewMounted(this.profileView, primaryContent)) {
      this.viewLifecycleManager.onViewUnmount(this.profileView);
    }

    const systemLogger = SystemLogger.getInstance();
    systemLogger.clearPageLogs();

    primaryContent.innerHTML = '';

    // Mount View Component based on route
    switch (viewType) {
      case 'not-logged-in': {
        // MainLayout: Show login screen
        if (this.mainLayout) {
          this.mainLayout.showLoginScreen();
        }
        break;
      }

      case 'timeline': {
        // TimelineUI: Reuse instance or create new
        if (!this.timelineUI) {
          const currentUser = this.authService.getCurrentUser();
          if (currentUser) {
            this.timelineUI = new Timeline(currentUser.pubkey);
          }
        }

        if (this.timelineUI) {
          primaryContent.appendChild(this.timelineUI.getElement());
          this.viewLifecycleManager.onViewMount(this.timelineUI);
        }
        break;
      }

      case 'single-note': {
        // SingleNoteView: New instance per note
        if (param) {
          const snv = new SingleNoteView(param);
          primaryContent.appendChild(snv.getElement());
        }
        break;
      }

      case 'profile': {
        // ProfileView: Reuse instance if same npub, else create new
        if (param) {
          if (!this.profileView || this.profileView.getNpub() !== param) {
            this.profileView = new ProfileView(param);
          }

          primaryContent.appendChild(this.profileView.getElement());
          this.viewLifecycleManager.onViewMount(this.profileView);
        }
        break;
      }

      case 'article': {
        // ArticleView: New instance per article
        if (param) {
          const articleView = new ArticleView(param);
          primaryContent.appendChild(articleView.getElement());
        }
        break;
      }

      case 'notifications': {
        // NotificationsView: Dynamic import + new instance
        const { NotificationsView } = await import('./components/views/NotificationsView');
        const notificationsView = new NotificationsView();
        primaryContent.appendChild(notificationsView.getElement());
        break;
      }

      case 'settings': {
        // SettingsView: New instance
        const settingsView = new SettingsView();
        primaryContent.appendChild(settingsView.getElement());
        break;
      }

      case 'write-article': {
        // ArticleEditorView: Full-page article editor
        const { ArticleEditorView } = await import('./components/views/ArticleEditorView');
        const articleEditor = new ArticleEditorView();
        primaryContent.appendChild(articleEditor.getElement());
        break;
      }

      case 'articles': {
        // ArticleTimelineView: Article feed
        const { ArticleTimelineView } = await import('./components/views/ArticleTimelineView');
        const articleTimeline = new ArticleTimelineView();
        primaryContent.appendChild(articleTimeline.getElement());
        break;
      }

      case 'mute-list': {
        // MuteListView: New instance
        const { MuteListView } = await import('./components/views/MuteListView');
        const muteListView = new MuteListView();
        primaryContent.appendChild(await muteListView.render());
        break;
      }
    }
  }

  private mountSecondaryContent(contentType: string): void {
    // Debug logger is already mounted in MainLayout
  }

  private setupUI(): void {
    if (!this.appElement) return;

    // Mount MainLayout (Sidebar + Primary/Secondary Content Areas)
    this.mainLayout = new MainLayout();
    this.appElement.appendChild(this.mainLayout.getElement());
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', this.handleResize.bind(this));
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    this.setupExternalLinkHandler();

    // EventBus: user:login → Create TimelineUI + Start NotificationsOrchestrator
    this.eventBus.on('user:login', this.handleUserLogin.bind(this));

    // EventBus: relays:updated → Recreate TimelineUI with new relay config
    this.eventBus.on('relays:updated', () => {
      const authService = AuthService.getInstance();
      const currentUser = authService.getCurrentUser();
      if (currentUser && this.timelineUI) {
        this.timelineUI.destroy();
        this.timelineUI = new Timeline(currentUser.pubkey);
        this.mountPrimaryContent('timeline');
      }
    });

    // EventBus: user:logout → Destroy TimelineUI + Navigate to Login
    this.eventBus.on('user:logout', () => {
      if (this.timelineUI) {
        this.timelineUI.destroy();
        this.timelineUI = null;
      }
      this.router.navigate('/login');
    });

    this.setupTauriCloseHandler();
  }

  private async setupTauriCloseHandler(): Promise<void> {
    if (!PlatformService.getInstance().isTauri) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();

      // Tauri Window Close: Ask user if NoorSigner daemon should stop
      await appWindow.onCloseRequested(async (event) => {
        const authMethod = this.authService.getAuthMethod();

        if (authMethod === 'key-signer') {
          event.preventDefault();

          const keySignerClient = KeySignerClient.getInstance();
          const isDaemonRunning = await keySignerClient.isRunning();

          if (isDaemonRunning) {
            // ModalService: Confirm daemon stop
            const modalService = ModalService.getInstance();
            const shouldStopDaemon = await modalService.confirm({
              title: 'Stop NoorSigner Daemon?',
              message: 'The NoorSigner daemon is currently running. Do you want to stop it when closing the app?',
              confirmText: 'Stop Daemon',
              cancelText: 'Keep Running',
              confirmDestructive: false
            });

            if (shouldStopDaemon) {
              try {
                await keySignerClient.stopDaemon();
              } catch (error) {
                // Daemon stop failed
              }
            }

            await appWindow.close();
          } else {
            await appWindow.close();
          }
        }
      });
    } catch (error) {
      // Tauri close handler setup failed
    }
  }

  private handleResize(): void {
    // CSS handles layout
  }

  private handleVisibilityChange(): void {
    // No performance optimizations needed - subscriptions are lightweight
  }

  private setupExternalLinkHandler(): void {
    document.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest('a');

      if (!anchor) return;

      const href = anchor.getAttribute('href');

      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        event.preventDefault();

        try {
          if (window.__TAURI__) {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(href);
          } else {
            window.open(href, '_blank', 'noopener,noreferrer');
          }
        } catch (error) {
          // External link open failed
        }
      }
    });
  }

  private async handleUserLogin(data: { npub: string; pubkey: string }): Promise<void> {
    // Only navigate if we're actually on /login page (user manually logged in)
    // Skip navigation on auto-login during reload (App.initialize handles that)
    const currentPath = this.router.getCurrentPath();
    const lastURL = this.router.getLastURL();

    if (currentPath === '/login' && (!lastURL || lastURL === '/login')) {
      // Real login scenario - redirect to timeline
      this.router.navigate('/');
    }

    // Create TimelineUI for logged-in user (only if not already created by route handler)
    if (!this.timelineUI) {
      this.timelineUI = new Timeline(data.pubkey);
    }

    // Load follow list into AppState (for mention autocomplete)
    // Also preload profiles in background for instant mentions
    try {
      const { UserService } = await import('./services/UserService');
      const { MentionProfileCache } = await import('./services/MentionProfileCache');

      const userService = UserService.getInstance();
      const mentionCache = MentionProfileCache.getInstance();

      const followingPubkeys = await userService.getUserFollowing(data.pubkey);

      this.appState.setState('user', {
        followingPubkeys
      });

      // Preload profiles in background (non-blocking, makes mentions instant)
      mentionCache.preloadProfiles(followingPubkeys).catch(err => {
        // Profile preload failed (non-critical)
      });
    } catch (error) {
      // Follow list load failed
    }

    try {
      // Start NotificationsOrchestrator
      const { NotificationsOrchestrator } = await import('./services/orchestration/NotificationsOrchestrator');
      const notificationsOrch = NotificationsOrchestrator.getInstance();

      await notificationsOrch.start();

      // Start article notification polling (1x per hour)
      const { ArticleNotificationService } = await import('./services/ArticleNotificationService');
      const articleNotifService = ArticleNotificationService.getInstance();
      articleNotifService.startPolling();

      // Badge updates are handled via EventBus ('notifications:badge-update')
      // NotificationsOrchestrator emits this event when new notifications arrive
    } catch (error) {
      // Notifications orchestrator start failed
    }
  }
}

// Global type declarations for Vite environment variables
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
