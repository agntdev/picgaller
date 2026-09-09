# PhotoGalleryBot — Bot specification

**Archetype:** content

**Voice:** warm and encouraging — write every user-facing message, button label, error, and empty state in this voice.

A lightweight Telegram gallery bot that surfaces curated image albums for public browsing and searching, and provides a simple admin interface (single ADMIN_CHAT_ID) for creating albums, uploading and reordering images, and removing content. Users browse albums, page through images with a carousel, search by keywords and tags, share or download images, and report inappropriate content; admins receive notifications for management actions.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- photography fans and portfolio viewers
- product teams and marketers showcasing images
- general Telegram users who enjoy curated image collections

## Success criteria

- Users can open /start and see a paginated list of albums with cover, title and actions
- Users can open an album and page images with Next/Prev, view captions, download and share
- Keyword search over album titles, image titles and tags returns paginated results
- Tag taps show images across albums filtered by tag
- Admin (matching ADMIN_CHAT_ID) can create/edit albums, upload images to an album, reorder and delete images/albums
- Admin receives a confirmation/notification to ADMIN_CHAT_ID after uploads and management actions
- All albums, image metadata, tags and file references persist between restarts and are re-served by the bot

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main gallery menu and show paged album list (page size 8)
  - outputs: paged album list with inline buttons
- **/search** (command, actor: user, command: /search) — Search albums and images by keyword (use ForceReply for query text)
  - inputs: text query
  - outputs: paged search results (image grid)
- **/admin** (command, actor: admin, command: /admin) — Open admin menu (restricted to ADMIN_CHAT_ID). Create/Edit albums, upload images, reorder/delete.
  - outputs: admin action menu with buttons
- **View Album** (button, actor: user, callback: album:view:<album_id>) — Open album carousel to view images one-by-one
  - inputs: album_id
  - outputs: image carousel messages with Next/Prev and image actions
- **Tag: <tag>** (button, actor: user, callback: tag:view:<tag>) — Show images across albums filtered by tag
  - inputs: tag
  - outputs: paged image grid

## Flows

### Browse albums (public)
_Trigger:_ /start

1. Bot replies with welcome text and first page of albums (8 per page). Each album card shows cover photo, title, short description and inline buttons: View Album, Share, Open Link (if present).
2. User taps 'View Album' → callback album:view:<id> opens album carousel.
3. Pagination buttons for album list (Prev/Next) use callback queries to fetch pages.

_Data touched:_ Album, Image

### Album carousel (public)
_Trigger:_ callback album:view:<album_id>

1. Bot sends the first image in album with caption (title/caption) and inline keyboard: Prev, Next, Download, Share, Report, Tags.
2. User taps Next/Prev → callback updates the message to show next/prev image (carousel behaviour).
3. Download uses Telegram native file download; Share uses Telegram native share; Report opens a short ForceReply form or quick choices to capture reason and forward to ADMIN_CHAT_ID.

_Data touched:_ Image, Album, Report

### Search (public)
_Trigger:_ /search

1. User invokes /search and replies with a keyword phrase (ForceReply or usual reply to /search prompt).
2. Bot searches album titles, image titles and tags and returns results as paged image grid (8 per page) with inline pagination.
3. User can tap an image to open carousel at that image's album and index.

_Data touched:_ Image, Album, Tag

### Browse by tag (public)
_Trigger:_ callback tag:view:<tag>

1. User taps a tag shown with an image or album listing.
2. Bot returns paged image grid of all images across albums that have the tag. Images link back to their album carousel position.

_Data touched:_ Image, Tag, Album

### Admin: Create/Edit album
_Trigger:_ /admin → Create Album (callback)

1. Bot verifies caller equals ADMIN_CHAT_ID.
2. Bot prompts for album title (ForceReply), then optional description, then optional cover image upload (photo or file).
3. Bot creates album record, persists metadata and sends confirmation to ADMIN_CHAT_ID and public seed if configured.

_Data touched:_ Album, AdminConfig

### Admin: Upload images to album
_Trigger:_ /admin → Upload Images

1. Bot verifies ADMIN_CHAT_ID, then prompts to select target album from a list (inline).
2. Admin uploads one or more images (Telegram photo or image file). For each upload, bot asks for an optional caption and optional tags (comma separated).
3. Bot stores files and metadata, appends to album ordering (or offers Insert Position), and sends upload confirmation to ADMIN_CHAT_ID.

_Data touched:_ Image, Album

### Admin: Reorder / Remove images
_Trigger:_ /admin → Reorder Images or Remove Image

1. Bot shows album contents with inline reorder actions (move up/down) and delete actions. Reorder actions update position atomically.
2. Deletes prompt confirmation; on confirm, bot removes metadata and file reference (per retention policy) and notifies ADMIN_CHAT_ID.

_Data touched:_ Image, Album

### Report flow (user reports image)
_Trigger:_ callback Report on image

1. Bot prompts user for report reason (quick choices + ForceReply for details).
2. Bot stores report record and forwards a formatted notification to ADMIN_CHAT_ID with image reference and reporter id (if reporter chooses to include).
3. Admin can act via /admin to remove content; bot may optionally mark the image as flagged.

_Data touched:_ Report, Image, AdminConfig

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where admin notifications and confirmations are sent (owner/admin Telegram chat id)
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Album** _(retention: persistent)_ — A collection grouping images with display order and cover.
  - fields: id (string), title (string), description (string), cover_image_id (string, optional), position (integer for album ordering), created_at (timestamp), updated_at (timestamp)
- **Image** _(retention: persistent)_ — Stored image file and its display metadata linking to an album.
  - fields: id (string), album_id (string), file_id or storage_reference (string), title_caption (string), tags ([string]), position_in_album (integer), uploader_id (Telegram user id or ADMIN_CHAT_ID), uploaded_at (timestamp)
- **Tag** _(retention: persistent)_ — Text labels used to categorize images; many-to-many with images.
  - fields: name (string), normalized (string)
- **Report** _(retention: persistent)_ — User-submitted reports about problematic images.
  - fields: id (string), image_id (string), reporter_id (optional, string), reason (string), details (string, optional), created_at (timestamp), status (open/resolved)
- **AdminConfig** _(retention: persistent)_ — Owner-supplied admin settings (single admin chat id and simple flags).
  - fields: ADMIN_CHAT_ID (integer chat id), notifications_enabled (boolean), seeded_albums_flag (boolean)

## Integrations

- **Telegram** (required) — Bot API messaging, inline keyboards, file upload/download and callback queries
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set ADMIN_CHAT_ID (single admin control)
- Create, edit and delete albums
- Upload images and set captions/tags
- Reorder images within an album (move up/down/insert at position)
- Remove images and albums (with confirmation)
- Toggle admin notifications on/off
- Seed default sample albums on first run

## Notifications

- Admin receives confirmation to ADMIN_CHAT_ID after image uploads (one notification per uploaded image or batch summary)
- Admin receives notifications for album create/edit/delete, image remove and reorder actions
- Admin receives forwarded user reports with image reference and reporter info (if provided)
- Users receive ephemeral confirmations for successful uploads (admin only) and for successful report submission

## Permissions & privacy

- Gallery browsing is public — images and metadata are visible to all Telegram users by default
- Only the configured ADMIN_CHAT_ID can perform management actions (create/edit/delete/reorder)
- When a user files a report, reporter identity is included only if the reporter consents or the platform requires it; otherwise reports can be anonymous
- Bot stores image files and metadata persistently; owners should decide deletion/retention policies
- No AI analysis or automated tagging is performed by the bot (explicit non-goal)

## Edge cases

- Unsupported file types or oversized images → bot rejects upload with a friendly error and allowed formats/size guidance
- Concurrent reorders by admin causing position conflicts → implement atomic reorder operations and conflict resolution via last-write-wins or explicit confirmation
- Pagination landing on an empty page after deletes → normalize page index to last available page
- Missing cover image for album → display first image or a default placeholder
- Unauthorized calls to /admin or admin callbacks → reply with polite access denied message and no leaked details
- Storage failure or missing file reference → show a friendly 'image unavailable' placeholder and log an error to owner notifications
- Duplicate image uploads → bot accepts duplicates but owner tools can detect potential duplicates (not automatic)
- User reports flood → rate-limit reports per user and batch notifications to ADMIN_CHAT_ID

## Required tests

- Dialog-level acceptance: /start shows first page of albums and page navigation works
- Album view carousel: opening album shows images and Next/Prev navigate correctly, captions render and image actions (Download, Share, Report) function
- Search flow: /search -> query returns correct images matching title, album title and tags; results are paged
- Tag browse: tapping a tag returns images across albums and links back to album carousel
- Admin auth: calls to /admin from non-ADMIN_CHAT_ID are rejected; ADMIN_CHAT_ID can access admin menu
- Admin upload: upload image to selected album, add caption/tags, confirm image appears in album and admin notification is sent
- Admin reorder/delete: reorder updates image positions and delete removes image and notifies admin; subsequent browsing reflects changes
- Report handling: user report creates a Report record and forwards expected notification to ADMIN_CHAT_ID
- Persistence test: restart bot process and verify albums, images and ordering persist and images can be re-served

## Assumptions

- Single-owner model is acceptable: one ADMIN_CHAT_ID governs all admin actions
- Storage for image files is available via the bot's environment/platform (file_id or internal storage) — specifics not provided
- Thumbnails/cover images will be derived from stored images or the first image in album if not explicitly provided
- Default content: up to 6 seeded sample albums will be created on first run to avoid empty UI
- Search is keyword-based and performed over stored text fields (no external search service)
- No payment or subscription features are needed
