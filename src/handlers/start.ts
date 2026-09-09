import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, mainMenuKeyboard, paginate } from "../toolkit/index.js";
import { GalleryStore } from "../gallery.js";

const composer = new Composer<Ctx>();
const WELCOME = "Welcome to Photo Gallery. Pick an album or explore from the menu.";
async function albums(ctx: Ctx, page: number, edit = false) {
  const store = await GalleryStore.open(ctx);
  if (!store) { const message = "The gallery is getting ready. Check back soon."; return edit ? ctx.editMessageText(message, { reply_markup: mainMenuKeyboard() }) : ctx.reply(message, { reply_markup: mainMenuKeyboard() }); }
  const all = await store.albums();
  if (!all.length) { const message = `${WELCOME}\n\nNo albums yet — come back when the curator adds the first photos.`; return edit ? ctx.editMessageText(message, { reply_markup: mainMenuKeyboard() }) : ctx.reply(message, { reply_markup: mainMenuKeyboard() }); }
  const part = paginate(all, { page, perPage: 8, callbackPrefix: "albums", prevLabel: "← Prev", nextLabel: "Next →" });
  const rows = part.pageItems.map((album) => [inlineButton(`View · ${album.title}`, `album:view:${album.id}`), ...(album.link ? [inlineButton("Open link", `album:link:${album.id}`)] : [])]);
  const text = `${WELCOME}\n\nAlbums · ${part.page + 1}/${part.totalPages}`;
  const markup = inlineKeyboard([...rows, ...part.controls.inline_keyboard, [inlineButton("Search", "search:start"), inlineButton("Menu", "menu:main")]]);
  return edit ? ctx.editMessageText(text, { reply_markup: markup }) : ctx.reply(text, { reply_markup: markup });
}
composer.command("start", async (ctx) => albums(ctx, 0));
composer.callbackQuery("gallery:albums", async (ctx) => { await ctx.answerCallbackQuery(); await albums(ctx, 0, true); });
composer.callbackQuery(/^albums:(?:prev|next):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await albums(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery("menu:main", async (ctx) => { await ctx.answerCallbackQuery(); await albums(ctx, 0, true); });
export default composer;
