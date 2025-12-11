# NoorNote

**NoorNote** (Arabic: نور, meaning "light") is a fast, privacy-focused desktop client for [Nostr](https://nostr.com) - the decentralized social protocol.

## Features

### Core
- **Timeline** - Follow your network, see latest posts, reposts, and quotes
- **Notifications** - Likes, zaps, reposts, mentions, and replies
- **Direct Messages** - Encrypted private conversations (NIP-17 + legacy NIP-04)
- **Long-Form Articles** - Read and write NIP-23 articles with dedicated timeline
- **Polls** - Create and vote on NIP-88 polls
- **Zaps** - Send and receive Lightning payments via NWC

### Highlights
- **Spotlight-like search** - Quick access to anything
- **Search in npub** - Search for keywords within a specific user's posts
- **Rich Bookmarks** - Sortable lists with folder organization
- **Custom Bookmarks** - Bookmark any URL, just like in a browser
- **Mute Threads** - Say bye to hell threads
- **Follow lists** - With mutual badges and zap balances
- **Quoted reposts** - Shown in note's replies
- **Article notifications** - Get notified on new articles per user
- **Analytics per note** - See who liked, reposted, quoted, replied, or zapped
- **Thread mention alerts** - Get notified when someone replies to a note you were mentioned in
- **Local list backups** - Manual NIP-51 list management, never lose your follows, bookmarks, or mutes again

...and many more to come.

## Download

Available for macOS, Linux, and Windows: [Releases](https://github.com/77elements/noornote/releases)

## Screenshots

*Coming soon*

## Privacy & Security

- **No tracking** - Zero analytics, no data collection
- **Local-first lists** - Follows, bookmarks, and mutes are stored locally with optional relay sync
- **Encrypted keys** - Private keys stored in system keychain (macOS), Secret Service (Linux), or Credential Manager (Windows)

## Troubleshooting

If the app crashes, check the log files:

| System | Log Location |
|--------|--------------|
| Linux | `~/.local/share/com.noornote.app/logs/` |
| macOS | `~/Library/Logs/com.noornote.app/` |
| Windows | `%LOCALAPPDATA%\com.noornote.app\logs\` |

## Login Options

| Method | Security | Convenience |
|--------|----------|-------------|
| NoorSigner | High | High |
| NIP-46 Remote Signer | High | Medium |

**Recommended:** Use NoorSigner for best security and convenience.

## Build from Source

### Requirements
- Node.js 18+
- Rust (for Tauri)
- Platform-specific dependencies (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))

### Development
```bash
git clone https://github.com/77elements/noornote.git
cd noornote
npm install
npm run tauri:dev
```

### Production Build
```bash
npm run tauri build
```

## NIPs Supported

| NIP | Description | Kind(s) |
|-----|-------------|---------|
| NIP-01 | Basic protocol (notes, profiles) | 0, 1 |
| NIP-02 | Follow list | 3 |
| NIP-04 | Encrypted DMs (legacy) | 4 |
| NIP-05 | DNS-based verification | - |
| NIP-07 | Browser extension signing | - |
| NIP-09 | Event deletion | 5 |
| NIP-10 | Reply threading | - |
| NIP-17 | Private Direct Messages | 13, 14, 1059, 10050 |
| NIP-18 | Reposts | 6 |
| NIP-19 | bech32 encoding (npub, nsec, note, nevent, naddr) | - |
| NIP-23 | Long-form content (articles) | 30023 |
| NIP-25 | Reactions | 7 |
| NIP-27 | Text note references | - |
| NIP-36 | Content warnings (NSFW) | - |
| NIP-44 | Encrypted payloads (modern encryption) | - |
| NIP-46 | Remote signing (bunker://) | 24133 |
| NIP-47 | Nostr Wallet Connect | 23194, 23195 |
| NIP-50 | Search | - |
| NIP-51 | Lists (bookmarks, mutes, private follows) | 10000, 30000, 30003 |
| NIP-56 | Reporting | 1984 |
| NIP-57 | Zaps | 9734, 9735 |
| NIP-65 | Relay list metadata | 10002 |
| NIP-78 | Application-specific data | 30078 |
| NIP-88 | Polls | 1068, 1018 |
| NIP-96 | HTTP file storage | 24242 |
| NIP-98 | HTTP auth | 27235 |

## Tech Stack

- **Frontend:** TypeScript, Vanilla JS, SASS
- **Desktop:** Tauri 2.0 (Rust)
- **Nostr:** NDK (Nostr Dev Kit)
- **Build:** Vite

## License

MIT

## Links

- [Nostr Protocol](https://nostr.com)
- [Report Issues](https://github.com/77elements/noornote/issues)
