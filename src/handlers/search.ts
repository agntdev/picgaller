import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { forceReply, GalleryStore, gallerySession } from "../gallery.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, paginate } from "../toolkit/index.js";
registerMainMenuItem({ label: "Search photos", data: "search:start", order: 10 });
const composer = new Composer<Ctx>();
async function results(ctx: Ctx, query: string, page: number, edit = false) {
  const store = await GalleryStore.open(ctx); if (!store) return ctx.reply("The gallery storage isn't available yet.");
  const matches = await store.search(query); if (!matches.length) { const text = `No photos match “${query}” yet — try another word or tag.`; return edit ? ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton("Search again", "search:start"), inlineButton("Albums", "gallery:albums")]] ) }) : ctx.reply(text); }
  const part = paginate(matches, { page, perPage: 8, callbackPrefix: `search:${encodeURIComponent(query)}`, prevLabel: "← Prev", nextLabel: "Next →" });
  const rows = part.pageItems.map(({ album, image, index }) => [inlineButton(image.caption || album.title, `album:at:${album.id}:${index}`)]);
  const text = `Matches for “${query}” · ${part.page + 1}/${part.totalPages}`;
  const markup = inlineKeyboard([...rows, ...part.controls.inline_keyboard, [inlineButton("Albums", "gallery:albums")]]);
  return edit ? ctx.editMessageText(text, { reply_markup: markup }) : ctx.reply(text, { reply_markup: markup });
}
async function ask(ctx: Ctx) { gallerySession(ctx).step = "search"; await ctx.reply("What would you like to find?", forceReply("Try a title or tag…")); }
composer.command("search", ask); composer.callbackQuery("search:start", async (ctx) => { await ctx.answerCallbackQuery(); await ask(ctx); });
composer.on("message:text", async (ctx, next) => { const session = gallerySession(ctx); if (session.step !== "search") return next(); const query = ctx.message.text.trim().slice(0, 80); if (!query) return ctx.reply("Send a word or tag to search for."); session.step = undefined; await results(ctx, query, 0); });
composer.callbackQuery(/^search:([^:]+):(prev|next):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await results(ctx, decodeURIComponent(ctx.match[1]), Number(ctx.match[3]), true); });
export default composer;
