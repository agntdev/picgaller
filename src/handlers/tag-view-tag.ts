import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { GalleryStore, normalizeTag } from "../gallery.js";
import { inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
const composer = new Composer<Ctx>();
async function show(ctx: Ctx, raw: string, page: number, edit = false) { const tag = normalizeTag(raw), store = await GalleryStore.open(ctx); if (!store) return ctx.reply("The gallery storage isn't available yet."); const matches = await store.tagged(tag); if (!matches.length) { const text = `No photos are tagged #${tag} yet.`; return edit ? ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton("Albums", "gallery:albums")]]) }) : ctx.reply(text); } const part = paginate(matches, { page, perPage: 8, callbackPrefix: `tag:${tag}`, prevLabel: "← Prev", nextLabel: "Next →" }); const rows = part.pageItems.map(({album,image,index}) => [inlineButton(image.caption || album.title, `album:at:${album.id}:${index}`)]); const markup = inlineKeyboard([...rows, ...part.controls.inline_keyboard, [inlineButton("Albums", "gallery:albums")]]); return edit ? ctx.editMessageText(`#${tag} · ${part.page + 1}/${part.totalPages}`, { reply_markup: markup }) : ctx.reply(`#${tag} · ${part.page + 1}/${part.totalPages}`, { reply_markup: markup }); }
composer.callbackQuery(/^tag:view:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, ctx.match[1], 0); });
composer.callbackQuery(/^tag:([^:]+):(prev|next):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, ctx.match[1], Number(ctx.match[3]), true); });
export default composer;
