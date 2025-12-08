/**
 * MediaUploadService
 * Modern implementation using fetch() + AbortController
 *
 * Features:
 * - Blossom (BUD-02) and NIP-96 support
 * - Multiple file uploads (sequential)
 * - Proper cancellation with AbortController
 * - Clean error handling
 * - Progress tracking
 */

import { AuthService } from './AuthService';
import { ErrorService } from './ErrorService';
import { ToastService } from './ToastService';

interface MediaServerSettings {
  url: string;
  protocol: 'blossom' | 'nip96';
}

interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

type ProgressCallback = (progress: number) => void;

export class MediaUploadService {
  private static instance: MediaUploadService;
  private authService: AuthService;
  private mediaServerStorageKey = 'noornote_media_server';
  private abortController: AbortController | null = null;

  // File size limits
  private readonly MAX_FILE_SIZE_FREE = 10 * 1024 * 1024; // 10 MB
  private readonly MAX_FILE_SIZE_BLOSSOM = 50 * 1024 * 1024; // 50 MB

  private constructor() {
    this.authService = AuthService.getInstance();
  }

  public static getInstance(): MediaUploadService {
    if (!MediaUploadService.instance) {
      MediaUploadService.instance = new MediaUploadService();
    }
    return MediaUploadService.instance;
  }

  /**
   * Load media server settings
   */
  private loadMediaServerSettings(): MediaServerSettings {
    try {
      const stored = localStorage.getItem(this.mediaServerStorageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (_error) {
      console.warn('Failed to load media server settings:', _error);
    }

    return {
      url: 'https://nostr.build',
      protocol: 'nip96'
    };
  }

  /**
   * Validate file
   */
  private validateFile(file: File, protocol: 'blossom' | 'nip96'): { valid: boolean; error?: string } {
    const maxSize = protocol === 'blossom' ? this.MAX_FILE_SIZE_BLOSSOM : this.MAX_FILE_SIZE_FREE;

    if (file.size > maxSize) {
      const maxSizeMB = Math.floor(maxSize / 1024 / 1024);
      return {
        valid: false,
        error: `File too large. Maximum size: ${maxSizeMB} MB`
      };
    }

    const supportedTypes = /^(image|video|audio)\//;
    if (!supportedTypes.test(file.type)) {
      return {
        valid: false,
        error: 'Unsupported file type. Only images, videos, and audio are allowed.'
      };
    }

    return { valid: true };
  }

  /**
   * Calculate SHA-256 hash
   */
  private async calculateSHA256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Create Blossom auth event (kind 24242) with timeout protection
   */
  private async createBlossomAuth(sha256: string): Promise<string> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const now = Math.floor(Date.now() / 1000);
    const expiration = now + 300; // 5 minutes

    const unsignedEvent = {
      kind: 24242,
      created_at: now,
      tags: [
        ['t', 'upload'],
        ['x', sha256],
        ['expiration', expiration.toString()]
      ],
      content: 'Upload file',
      pubkey: currentUser.pubkey
    };

    // Wrap signEvent with timeout to prevent infinite hang
    const signedEvent = await this.signEventWithTimeout(unsignedEvent, 30000); // 30 second timeout
    return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
  }

  /**
   * Create NIP-98 auth event (kind 27235) with timeout protection
   */
  private async createNIP98Auth(method: string, url: string, sha256: string): Promise<string> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const unsignedEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', url],
        ['method', method],
        ['payload', sha256]  // NIP-98: payload tag must be hex, not base64!
      ],
      content: '',
      pubkey: currentUser.pubkey
    };

    // Wrap signEvent with timeout to prevent infinite hang
    const signedEvent = await this.signEventWithTimeout(unsignedEvent, 30000); // 30 second timeout
    return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
  }

  /**
   * Sign event with timeout protection
   * Browser extensions can hang indefinitely - this prevents that
   */
  private async signEventWithTimeout(event: any, timeoutMs: number): Promise<any> {
    return Promise.race([
      this.authService.signEvent(event),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Signing timeout - please check your browser extension')), timeoutMs)
      )
    ]);
  }

  /**
   * Upload file using Blossom protocol
   */
  private async uploadBlossom(
    file: File,
    serverUrl: string,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      // Pseudo-progress timer (simulates upload progress)
      let pseudoProgress = 1;
      let pseudoTimer: number | undefined;

      const startPseudoProgress = () => {
        if (pseudoTimer !== undefined) return;
        pseudoTimer = window.setInterval(() => {
          pseudoProgress = Math.min(pseudoProgress + 3, 90);
          onProgress?.(pseudoProgress);
          if (pseudoProgress >= 90) {
            stopPseudoProgress();
          }
        }, 300);
      };

      const stopPseudoProgress = () => {
        if (pseudoTimer !== undefined) {
          clearInterval(pseudoTimer);
          pseudoTimer = undefined;
        }
      };

      // Calculate hash first
      this.calculateSHA256(file)
        .then(sha256 => {
          onProgress?.(10);
          return this.createBlossomAuth(sha256).then(authHeader => ({ sha256, authHeader }));
        })
        .then(({ authHeader }) => {
          onProgress?.(20);

          const xhr = new XMLHttpRequest();
          this.abortController = new AbortController();

          // Add 60 second timeout
          const uploadTimeout = setTimeout(() => {
            xhr.abort();
            stopPseudoProgress();
            reject(new Error('Upload timeout - please try again'));
          }, 60000);

          // Track upload progress
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              stopPseudoProgress();
              const percent = Math.round((event.loaded / event.total) * 100);
              const mappedProgress = 20 + Math.round(percent * 0.7); // Map to 20-90%
              onProgress?.(mappedProgress);
            }
          };

          xhr.onload = () => {
            clearTimeout(uploadTimeout);
            stopPseudoProgress();
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const descriptor = JSON.parse(xhr.responseText);
                onProgress?.(100);
                resolve({
                  success: true,
                  url: descriptor.url
                });
              } catch (_error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
            }
            this.abortController = null;
          };

          xhr.onerror = () => {
            clearTimeout(uploadTimeout);
            stopPseudoProgress();
            this.abortController = null;
            reject(new Error('Network error'));
          };

          xhr.onabort = () => {
            clearTimeout(uploadTimeout);
            stopPseudoProgress();
            this.abortController = null;
            reject(new Error('Upload cancelled'));
          };

          // Handle abort signal
          this.abortController.signal.addEventListener('abort', () => {
            xhr.abort();
          });

          xhr.open('PUT', `${serverUrl}/upload`);
          xhr.setRequestHeader('Authorization', authHeader);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

          startPseudoProgress();
          xhr.send(file);
        })
        .catch((_error) => {
          stopPseudoProgress();
          this.abortController = null;
          reject(_error);
        });
    })
      .then(result => result as UploadResult)
      .catch((_error: any) => {
        console.error('Blossom upload error:', _error);
        return {
          success: false,
          error: `Upload error: ${_error.message || _error}`
        };
      });
  }

  /**
   * Fetch NIP-96 config
   */
  private async fetchNIP96Config(serverUrl: string): Promise<{ api_url: string } | null> {
    try {
      const response = await fetch(`${serverUrl}/.well-known/nostr/nip96.json`);
      if (!response.ok) return null;
      return await response.json();
    } catch (_error) {
      console.warn('Failed to fetch NIP-96 config:', _error);
      return null;
    }
  }

  /**
   * Upload file using NIP-96 protocol
   */
  private async uploadNIP96(
    file: File,
    serverUrl: string,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    return new Promise(async (resolve, reject) => {
      // Pseudo-progress timer (simulates upload progress)
      let pseudoProgress = 1;
      let pseudoTimer: number | undefined;

      const startPseudoProgress = () => {
        if (pseudoTimer !== undefined) return;
        pseudoTimer = window.setInterval(() => {
          pseudoProgress = Math.min(pseudoProgress + 3, 90);
          onProgress?.(pseudoProgress);
          if (pseudoProgress >= 90) {
            stopPseudoProgress();
          }
        }, 300);
      };

      const stopPseudoProgress = () => {
        if (pseudoTimer !== undefined) {
          clearInterval(pseudoTimer);
          pseudoTimer = undefined;
        }
      };

      try {
        // Fetch config
        onProgress?.(5);
        const config = await this.fetchNIP96Config(serverUrl);
        const apiUrl = config?.api_url || `${serverUrl}/upload`;

        // Calculate hash
        onProgress?.(10);
        const sha256 = await this.calculateSHA256(file);

        // Create auth
        onProgress?.(20);
        const authHeader = await this.createNIP98Auth('POST', apiUrl, sha256);

        // Prepare form data
        const formData = new FormData();
        formData.append('file', file);
        formData.append('content_type', file.type);
        formData.append('size', file.size.toString());

        // Upload with XHR
        const xhr = new XMLHttpRequest();
        this.abortController = new AbortController();

        // Add 60 second timeout
        const uploadTimeout = setTimeout(() => {
          xhr.abort();
          stopPseudoProgress();
          reject(new Error('Upload timeout - please try again'));
        }, 60000);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            stopPseudoProgress();
            const percent = Math.round((event.loaded / event.total) * 100);
            const mappedProgress = 20 + Math.round(percent * 0.7); // Map to 20-90%
            onProgress?.(mappedProgress);
          }
        };

        xhr.onload = () => {
          clearTimeout(uploadTimeout);
          stopPseudoProgress();
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              if (result.status === 'success' && result.nip94_event) {
                const urlTag = result.nip94_event.tags.find((t: string[]) => t[0] === 'url');
                if (urlTag) {
                  onProgress?.(100);
                  resolve({
                    success: true,
                    url: urlTag[1]
                  });
                } else {
                  reject(new Error('No URL in upload response'));
                }
              } else {
                reject(new Error('No URL in upload response'));
              }
            } catch (_error) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
          this.abortController = null;
        };

        xhr.onerror = () => {
          clearTimeout(uploadTimeout);
          stopPseudoProgress();
          this.abortController = null;
          reject(new Error('Network error'));
        };

        xhr.onabort = () => {
          clearTimeout(uploadTimeout);
          stopPseudoProgress();
          this.abortController = null;
          reject(new Error('Upload cancelled'));
        };

        // Handle abort signal
        this.abortController.signal.addEventListener('abort', () => {
          xhr.abort();
        });

        xhr.open('POST', apiUrl);
        xhr.setRequestHeader('Authorization', authHeader);

        startPseudoProgress();
        xhr.send(formData);
      } catch (_error) {
        stopPseudoProgress();
        this.abortController = null;
        reject(_error);
      }
    })
      .then(result => result as UploadResult)
      .catch((_error: any) => {
        console.error('NIP-96 upload error:', _error);
        return {
          success: false,
          error: `Upload error: ${_error.message || _error}`
        };
      });
  }

  /**
   * Upload a single file
   */
  public async uploadFile(file: File, onProgress?: ProgressCallback): Promise<UploadResult> {
    try {
      // Check auth
      const currentUser = this.authService.getCurrentUser();
      if (!currentUser) {
        const errorMsg = 'Please log in to upload files';
        ToastService.show(errorMsg, 'error');
        return {
          success: false,
          error: errorMsg
        };
      }

      // Load settings
      const settings = this.loadMediaServerSettings();

      // Validate
      const validation = this.validateFile(file, settings.protocol);
      if (!validation.valid) {
        ToastService.show(validation.error || 'Invalid file', 'error');
        return {
          success: false,
          error: validation.error
        };
      }

      // Upload
      const result = settings.protocol === 'blossom'
        ? await this.uploadBlossom(file, settings.url, onProgress)
        : await this.uploadNIP96(file, settings.url, onProgress);

      // Show feedback to user
      if (result.success) {
        ToastService.show('File uploaded successfully!', 'success');
      } else {
        ToastService.show(result.error || 'Upload failed', 'error');
      }

      return result;
    } catch (_error) {
      ErrorService.handle(_error, 'MediaUploadService.uploadFile', true, 'Failed to upload file');
      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Upload failed'
      };
    }
  }

  /**
   * Upload multiple files (sequentially)
   */
  public async uploadFiles(
    files: File[],
    onProgress?: (fileIndex: number, progress: number, totalFiles: number) => void
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const result = await this.uploadFile(files[i], (progress) => {
        onProgress?.(i, progress, files.length);
      });
      results.push(result);

      // Stop on first error
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Cancel ongoing upload
   */
  public cancelUpload(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
