import type { Ctx } from "./bot.js";
import { adminChatId } from "./toolkit/index.js";

declare module "./bot.js" {
  interface Session {
    step?: string;
    albumId?: string;
    pendingTitle?: string;
    pendingFileId?: string;
    pendingCaption?: string;
    reportImageId?: string;
    reportReason?: string;
    reportDetails?: string;
    reportTimes?: number[];
  }
}

export interface Album { id: string; title: string; description: string; coverImageId?: string; position: number; createdAt: number; updatedAt: number; imageIds: string[]; link?: string }
export interface GalleryImage { id: string; albumId: string; fileId: string; caption: string; tags: string[]; position: number; uploaderId: string; uploadedAt: number }
export interface Report { id: string; imageId: string; reporterId?: string; reason: string; details?: string; createdAt: number; status: "open" | "resolved" }
interface Index { albumIds: string[]; reportIds: string[]; notificationsEnabled: boolean; seeded?: boolean }
interface D1Result { results?: unknown[] }
interface D1Statement { bind(...values: unknown[]): D1Statement; first<T>(): Promise<T | null>; run(): Promise<unknown> }
interface D1 { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> }
interface GalleryStub { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> }
interface GalleryNamespace { idFromName(name: string): unknown; get(id: unknown): GalleryStub }

/** The one clock seam for every timestamp and report-window decision. */
export let now = (): number => Date.now();
export function setNowForTest(value: () => number): void { now = value; }

function db(ctx: Ctx): D1 | undefined {
  return (ctx as Ctx & { env?: { DB?: D1 } }).env?.DB;
}
class DoStatement implements D1Statement {
  private values: unknown[] = [];
  constructor(private readonly store: DoDatabase, private readonly query: string) {}
  bind(...values: unknown[]): D1Statement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { if (!this.query.startsWith("SELECT")) return null; const response = await this.store.call("/gallery/record/" + encodeURIComponent(String(this.values[0])), "GET"); return response.status === 404 ? null : await response.json() as T; }
  async run(): Promise<unknown> { const op = this.operation(); if (op) await this.store.call("/gallery/record/" + encodeURIComponent(op.key), op.delete ? "DELETE" : "PUT", op.delete ? undefined : JSON.stringify({ value: op.value })); return {}; }
  operation(): { key: string; value?: unknown; delete?: boolean } | undefined { if (this.query.startsWith("CREATE")) return undefined; if (this.query.startsWith("DELETE")) return { key: String(this.values[0]), delete: true }; return { key: String(this.values[0]), value: this.values[1] }; }
}
class DoDatabase implements D1 {
  constructor(private readonly stub: GalleryStub) {}
  call(path: string, method: string, body?: string): Promise<Response> { return this.stub.fetch("https://do" + path, { method, body }); }
  prepare(query: string): D1Statement { return new DoStatement(this, query); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> { const operations = (statements as DoStatement[]).map((statement) => statement.operation()).filter((value): value is { key: string; value?: unknown; delete?: boolean } => !!value); await this.call("/gallery/batch", "POST", JSON.stringify(operations)); return []; }
}
function doDatabase(ctx: Ctx): D1 | undefined { const ns = (ctx as Ctx & { env?: { CHAT_DO?: GalleryNamespace } }).env?.CHAT_DO; return ns ? new DoDatabase(ns.get(ns.idFromName("gallery:global"))) : undefined; }

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export class GalleryStore {
  private constructor(private readonly database: D1) {}
  static async open(ctx: Ctx): Promise<GalleryStore | undefined> {
    const database = db(ctx) ?? doDatabase(ctx);
    if (!database) return undefined;
    await database.prepare("CREATE TABLE IF NOT EXISTS gallery_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    const store = new GalleryStore(database);
    if (!(await store.get<Index>("index"))) await store.put("index", { albumIds: [], reportIds: [], notificationsEnabled: true } satisfies Index);
    return store;
  }
  private async get<T>(key: string): Promise<T | undefined> {
    const row = await this.database.prepare("SELECT value FROM gallery_records WHERE key = ?").bind(key).first<{ value: string }>();
    if (!row) return undefined;
    try { return JSON.parse(row.value) as T; } catch { return undefined; }
  }
  private put(key: string, value: unknown): Promise<unknown> {
    return this.database.prepare("INSERT INTO gallery_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, JSON.stringify(value)).run();
  }
  private async putMany(rows: Array<[string, unknown]>): Promise<void> {
    await this.database.batch(rows.map(([key, value]) => this.database.prepare("INSERT INTO gallery_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, JSON.stringify(value))));
  }
  private async index(): Promise<Index> { return (await this.get<Index>("index")) ?? { albumIds: [], reportIds: [], notificationsEnabled: true }; }
  async albums(): Promise<Album[]> { const i = await this.index(); return (await Promise.all(i.albumIds.map((id) => this.get<Album>(`album:${id}`)))).filter((v): v is Album => !!v).sort((a,b) => a.position-b.position); }
  async album(id: string): Promise<Album | undefined> { return this.get(`album:${id}`); }
  async image(id: string): Promise<GalleryImage | undefined> { return this.get(`image:${id}`); }
  async images(album: Album): Promise<GalleryImage[]> { return (await Promise.all(album.imageIds.map((id) => this.image(id)))).filter((v): v is GalleryImage => !!v).sort((a,b) => a.position-b.position); }
  async createAlbum(title: string, description: string): Promise<Album> {
    const index = await this.index(); const t = now();
    const album: Album = { id: uid("a"), title, description, position: index.albumIds.length, createdAt: t, updatedAt: t, imageIds: [] };
    index.albumIds.push(album.id); await this.putMany([[`album:${album.id}`, album], ["index", index]]); return album;
  }
  async updateAlbum(album: Album): Promise<void> { album.updatedAt = now(); await this.put(`album:${album.id}`, album); }
  async addImage(album: Album, fileId: string, caption: string, tags: string[], uploaderId: string): Promise<GalleryImage> {
    const image: GalleryImage = { id: uid("i"), albumId: album.id, fileId, caption, tags: tags.map(normalizeTag).filter(Boolean), position: album.imageIds.length, uploaderId, uploadedAt: now() };
    album.imageIds.push(image.id); if (!album.coverImageId) album.coverImageId = image.id; album.updatedAt = now();
    await this.putMany([[`image:${image.id}`, image], [`album:${album.id}`, album]]); return image;
  }
  async reorder(album: Album, imageId: string, direction: -1 | 1): Promise<boolean> {
    const at = album.imageIds.indexOf(imageId), to = at + direction;
    if (at < 0 || to < 0 || to >= album.imageIds.length) return false;
    [album.imageIds[at], album.imageIds[to]] = [album.imageIds[to], album.imageIds[at]];
    const images = await this.images(album); images.forEach((image, position) => { image.position = position; }); album.updatedAt = now();
    await this.putMany([[`album:${album.id}`, album], ...images.map((image) => [`image:${image.id}`, image] as [string, unknown])]); return true;
  }
  async deleteImage(album: Album, imageId: string): Promise<boolean> {
    const at = album.imageIds.indexOf(imageId); if (at < 0) return false;
    album.imageIds.splice(at, 1); if (album.coverImageId === imageId) album.coverImageId = album.imageIds[0]; album.updatedAt = now();
    const images = await this.images(album); images.forEach((image, position) => { image.position = position; });
    const deleteStatement = this.database.prepare("DELETE FROM gallery_records WHERE key = ?").bind(`image:${imageId}`);
    await this.database.batch([deleteStatement, this.database.prepare("INSERT INTO gallery_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`album:${album.id}`, JSON.stringify(album)), ...images.map((image) => this.database.prepare("INSERT INTO gallery_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`image:${image.id}`, JSON.stringify(image)))]); return true;
  }
  async deleteAlbum(album: Album): Promise<void> { const index = await this.index(); index.albumIds = index.albumIds.filter((id) => id !== album.id); await this.database.batch([this.database.prepare("DELETE FROM gallery_records WHERE key = ?").bind(`album:${album.id}`), ...album.imageIds.map((id) => this.database.prepare("DELETE FROM gallery_records WHERE key = ?").bind(`image:${id}`)), this.database.prepare("INSERT INTO gallery_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind("index", JSON.stringify(index))]); }
  async search(query: string): Promise<Array<{ album: Album; image: GalleryImage; index: number }>> { const q = query.toLocaleLowerCase(); const albums = await this.albums(); const out: Array<{ album: Album; image: GalleryImage; index: number }> = []; for (const album of albums) { const albumMatch = `${album.title} ${album.description}`.toLocaleLowerCase().includes(q); for (const [index, image] of (await this.images(album)).entries()) if (albumMatch || `${image.caption} ${image.tags.join(" ")}`.toLocaleLowerCase().includes(q)) out.push({ album, image, index }); } return out; }
  async tagged(tag: string): Promise<Array<{ album: Album; image: GalleryImage; index: number }>> { const q = normalizeTag(tag); const out: Array<{ album: Album; image: GalleryImage; index: number }> = []; for (const album of await this.albums()) for (const [index, image] of (await this.images(album)).entries()) if (image.tags.includes(q)) out.push({ album, image, index }); return out; }
  async addReport(report: Omit<Report, "id" | "createdAt" | "status">): Promise<Report> { const index = await this.index(); const item: Report = { ...report, id: uid("r"), createdAt: now(), status: "open" }; index.reportIds.push(item.id); await this.putMany([[`report:${item.id}`, item], ["index", index]]); return item; }
  async notificationsEnabled(): Promise<boolean> { return (await this.index()).notificationsEnabled; }
  async toggleNotifications(): Promise<boolean> { const index = await this.index(); index.notificationsEnabled = !index.notificationsEnabled; await this.put("index", index); return index.notificationsEnabled; }
  async seedStarterAlbums(): Promise<number> {
    const index = await this.index();
    if (index.seeded) return 0;
    // These are intentionally empty collection shells: the owner adds the real
    // photographs, captions, and tags after choosing a look for the gallery.
    const names = ["New arrivals", "Featured work", "Behind the scenes", "People", "Places", "Details"];
    const t = now(); const albums = names.map((title, position): Album => ({ id: uid("a"), title, description: "", position, createdAt: t, updatedAt: t, imageIds: [] }));
    index.albumIds.push(...albums.map((album) => album.id)); index.seeded = true;
    await this.putMany([["index", index], ...albums.map((album) => [`album:${album.id}`, album] as [string, unknown])]); return albums.length;
  }
  async reportAllowed(reporter: string): Promise<boolean> {
    const key = `reporter:${reporter}`; const recent = ((await this.get<number[]>(key)) ?? []).filter((time) => now() - time < 60 * 60 * 1000);
    if (recent.length >= 5) return false;
    recent.push(now()); await this.put(key, recent); return true;
  }
}

export function normalizeTag(value: string): string { return value.trim().toLocaleLowerCase().replace(/^#/, "").slice(0, 40); }
export async function notifyOwner(ctx: Ctx, text: string, store?: GalleryStore): Promise<void> { const owner = adminChatId(ctx as { env?: Record<string, unknown> }); if (!owner || (store && !(await store.notificationsEnabled()))) return; try { await ctx.api.sendMessage(owner, text); } catch { /* a blocked chat must not break gallery work */ } }
export function forceReply(placeholder: string) { return { reply_markup: { force_reply: true as const, input_field_placeholder: placeholder } }; }
export interface GallerySession { step?: string; albumId?: string; pendingTitle?: string; pendingFileId?: string; pendingCaption?: string; reportImageId?: string; reportReason?: string; reportDetails?: string; reportTimes?: number[] }
export function gallerySession(ctx: Ctx): GallerySession { return ctx.session as GallerySession; }
