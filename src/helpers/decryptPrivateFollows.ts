/**
 * Decrypt private follow list items using NIP-44/NIP-04 with fallback
 * Automatically detects auth method (browser extension, KeySigner, or NIP-46)
 * Used for NIP-51 private follow lists with backward compatibility
 *
 * Fallback Logic:
 * 1. Auto-detect format (NIP-44 vs NIP-04 via `?iv=` check)
 * 2. Try the detected protocol first
 * 3. If it fails → try the other protocol
 * 4. If both fail → return empty array (graceful failure)
 *
 * @param encryptedContent - Base64-encoded encrypted payload from event.content
 * @param authorPubkey - Author's public key (for self-decryption)
 * @returns Array of decrypted hex pubkeys
 *
 * @example
 * const pubkeys = await decryptPrivateFollows(
 *   event.content,
 *   authorPubkey
 * );
 */
export async function decryptPrivateFollows(
  encryptedContent: string,
  authorPubkey: string
): Promise<string[]> {
  // Empty content = no private follows
  if (!encryptedContent || encryptedContent.trim() === '') {
    return [];
  }

  try {
    // Auto-detect NIP-04 vs NIP-44 (backward compatibility)
    const isNip04 = encryptedContent.includes('?iv=');

    let plaintext: string | null = null;

    // Detect auth method
    const { AuthService } = await import('../services/AuthService');
    const authService = AuthService.getInstance();
    const authMethod = authService.getAuthMethod();

    if (authMethod === 'key-signer') {
      // Use KeySigner for decryption
      const { KeySignerClient } = await import('../services/KeySignerClient');
      const keySigner = KeySignerClient.getInstance();

      if (isNip04) {
        // Try NIP-04 first, then NIP-44 fallback
        try {
          plaintext = await keySigner.nip04Decrypt(encryptedContent, authorPubkey);
        } catch (_nip04Error) {
          try {
            plaintext = await keySigner.nip44Decrypt(encryptedContent, authorPubkey);
          } catch (_nip44Error) {
            return [];
          }
        }
      } else {
        // Try NIP-44 first, then NIP-04 fallback
        try {
          plaintext = await keySigner.nip44Decrypt(encryptedContent, authorPubkey);
        } catch (_nip44Error) {
          try {
            plaintext = await keySigner.nip04Decrypt(encryptedContent, authorPubkey);
          } catch (_nip04Error) {
            return [];
          }
        }
      }
    } else if (authMethod === 'extension') {
      // Use browser extension
      if (isNip04) {
        // Try NIP-04 first, then NIP-44 fallback
        try {
          if (!window.nostr?.nip04?.decrypt) {
            throw new Error('NIP-04 not available');
          }
          plaintext = await window.nostr.nip04.decrypt(authorPubkey, encryptedContent);
        } catch (_nip04Error) {
          try {
            if (!window.nostr?.nip44?.decrypt) {
              throw new Error('NIP-44 not available');
            }
            plaintext = await window.nostr.nip44.decrypt(authorPubkey, encryptedContent);
          } catch (_nip44Error) {
            return [];
          }
        }
      } else {
        // Try NIP-44 first, then NIP-04 fallback
        try {
          if (!window.nostr?.nip44?.decrypt) {
            throw new Error('NIP-44 not available');
          }
          plaintext = await window.nostr.nip44.decrypt(authorPubkey, encryptedContent);
        } catch (_nip44Error) {
          try {
            if (!window.nostr?.nip04?.decrypt) {
              throw new Error('NIP-04 not available');
            }
            plaintext = await window.nostr.nip04.decrypt(authorPubkey, encryptedContent);
          } catch (_nip04Error) {
            return [];
          }
        }
      }
    } else if (authMethod === 'nip46') {
      // Use NIP-46 remote signer for decryption
      const { AuthService } = await import('../services/AuthService');
      const nip46Manager = (AuthService.getInstance() as any).nip46Manager;

      if (!nip46Manager?.isAvailable()) {
        return [];
      }

      if (isNip04) {
        // Try NIP-04 first, then NIP-44 fallback
        try {
          plaintext = await nip46Manager.nip04Decrypt(encryptedContent, authorPubkey);
        } catch (_nip04Error) {
          try {
            plaintext = await nip46Manager.nip44Decrypt(encryptedContent, authorPubkey);
          } catch (_nip44Error) {
            return [];
          }
        }
      } else {
        // Try NIP-44 first, then NIP-04 fallback
        try {
          plaintext = await nip46Manager.nip44Decrypt(encryptedContent, authorPubkey);
        } catch (_nip44Error) {
          try {
            plaintext = await nip46Manager.nip04Decrypt(encryptedContent, authorPubkey);
          } catch (_nip04Error) {
            return [];
          }
        }
      }
    } else if (authMethod === 'nsec') {
      // Use nostr-tools for direct nsec decryption (NIP-44 only)
      if (isNip04) {
        return [];
      }

      const { nip44 } = await import('nostr-tools');
      const { KeychainStorage } = await import('../services/KeychainStorage');
      const { decodeNip19 } = await import('../services/NostrToolsAdapter');

      const nsec = await KeychainStorage.loadNsec();
      if (!nsec) {
        return [];
      }

      const decoded = decodeNip19(nsec);
      if (decoded.type !== 'nsec') {
        return [];
      }
      const privateKey = decoded.data as string;

      // NIP-44 conversation key requires hex bytes, not string
      const privKeyBytes = new Uint8Array(privateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      const pubKeyBytes = new Uint8Array(authorPubkey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

      const conversationKey = nip44.v2.utils.getConversationKey(privKeyBytes, pubKeyBytes);
      plaintext = nip44.v2.decrypt(encryptedContent, conversationKey);
    } else {
      return [];
    }

    if (!plaintext) {
      return [];
    }

    // Parse JSON to get tag array
    const privateTags: string[][] = JSON.parse(plaintext);

    // Validate structure
    if (!Array.isArray(privateTags)) {
      return [];
    }

    // Extract pubkeys from ["p", "pubkey"] tags
    const pubkeys = privateTags
      .filter(tag => Array.isArray(tag) && tag[0] === 'p' && tag[1])
      .map(tag => tag[1]);

    return pubkeys;
  } catch (_error) {
    return []; // Fail gracefully
  }
}
