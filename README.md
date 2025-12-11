# NoorNote

**NoorNote** (Arabic: نور, meaning "light") is a fast, privacy-focused desktop client for [Nostr](https://nostr.com) - the decentralized social protocol.

## Features

- **Timeline** - Follow your network, see latest posts, reposts, and quotes
- **Notifications** - Likes, zaps, reposts, mentions, and replies
- **Direct Messages** - Encrypted private conversations (NIP-17 + legacy NIP-04)
- **Long-Form Articles** - Read and write NIP-23 articles with Markdown
- **Bookmarks** - Save posts privately or publicly, organize in folders
- **Polls** - Create and vote on NIP-88 polls
- **Zaps** - Send and receive Lightning payments via NWC
- **Multiple Login Methods** - Browser extension, nsec, NIP-46 remote signer, or NoorSigner

## Download

Coming soon for macOS, Linux, and Windows.

## Screenshots

*Coming soon*

## Privacy & Security

- **No tracking** - Zero analytics, no data collection
- **Local-first** - Your data stays on your device
- **Open source** - Fully auditable code
- **Encrypted keys** - Private keys stored in system keychain (macOS) or encrypted storage

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
| Browser Extension | High | Medium |
| NoorSigner | High | High |
| NIP-46 Remote Signer | High | Medium |
| nsec (direct key) | Low | High |

**Recommended:** Use a browser extension (nos2x, Alby) or NoorSigner for best security.

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
