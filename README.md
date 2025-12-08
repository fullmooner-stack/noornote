# NoorNote

**NoorNote** (Arabic: نور, meaning "light") is a fast, privacy-focused desktop client for [Nostr](https://nostr.com) - the decentralized social protocol.

## Features

- **Timeline** - Follow your network, see latest posts, reposts, and quotes
- **Notifications** - Likes, zaps, reposts, mentions, and replies
- **Direct Messages** - Encrypted private conversations (NIP-04/NIP-44)
- **Long-Form Articles** - Read and write NIP-23 articles with Markdown
- **Bookmarks** - Save posts privately or publicly, organize in folders
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

| NIP | Description |
|-----|-------------|
| NIP-01 | Basic protocol |
| NIP-02 | Follow list |
| NIP-04 | Encrypted DMs (legacy) |
| NIP-05 | DNS-based verification |
| NIP-10 | Reply threading |
| NIP-18 | Reposts |
| NIP-23 | Long-form content |
| NIP-25 | Reactions |
| NIP-27 | Text note references |
| NIP-44 | Encrypted DMs (modern) |
| NIP-47 | Nostr Wallet Connect |
| NIP-51 | Lists (bookmarks, mutes) |
| NIP-57 | Zaps |
| NIP-65 | Relay list metadata |

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
