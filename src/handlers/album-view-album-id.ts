import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { GalleryStore } from "../gallery.js";

const composer = new Composer<Ctx>();
function keys(imageId: string, albumId: string, position: number, count: number, tags: string[]) {
  const nav = [position > 0 ? inlineButton("← Prev", `album:at:${albumId}:${position - 1}`) : undefined, position + 1 < count ? inlineButton("Next →", `album:at:${albumId}:${position + 1}`) : undefined].filter((x): x is NonNullable<typeof x> => !!x);
  return inlineKeyboard([nav, [inlineButton("Download", `image:download:${imageId}`), inlineButton("Share", `image:share:${imageId}`)], [inlineButton("Report", `report:start:${imageId}`)], ...(tags.length ? [tags.slice(0, 6).map((tag) => inlineButton(`#${tag}`, `tag:view:${tag}`))] : []), [inlineButton("Albums", "gallery:albums")]]);
}
async function show(ctx: Ctx, albumId: string, requested: number, edit: boolean) {
  const store = await GalleryStore.open(ctx); const album = store && await store.album(albumId);
  if (!store) return ctx.reply("The gallery storage isn't available yet.");
  if (!album) return ctx.reply("That album isn't available anymore.");
  const images = await store.images(album); if (!images.length) return ctx.reply("This album is waiting for its first photo.");
  const position = Math.min(Math.max(0, requested), images.length - 1), image = images[position];
  const caption = `${album.title} · ${position + 1}/${images.length}${image.caption ? `\n${image.caption}` : ""}`;
  const reply_markup = keys(image.id, album.id, position, images.length, image.tags);
  if (edit) { await ctx.editMessageMedia({ type: "photo", media: image.fileId, caption }, { reply_markup }); } else await ctx.replyWithPhoto(image.fileId, { caption, reply_markup });
}
composer.callbackQuery(/^album:view:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, ctx.match[1], 0, false); });
composer.callbackQuery(/^album:at:([^:]+):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, ctx.match[1], Number(ctx.match[2]), true); });
composer.callbackQuery(/^image:download:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const store = await GalleryStore.open(ctx), image = store && await store.image(ctx.match[1]); if (!image) return ctx.reply("That image isn't available anymore."); await ctx.replyWithDocument(image.fileId, { caption: image.caption || "Here’s the original image." }); });
composer.callbackQuery(/^image:share:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery({ text: "You can forward this photo to share it." }); });
export default composer;
