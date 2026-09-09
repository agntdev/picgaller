import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { forceReply, GalleryStore, notifyOwner } from "../gallery.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();
composer.callbackQuery(/^report:start:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.match[1];
  await ctx.reply("What’s wrong with this photo?", { reply_markup: inlineKeyboard([[inlineButton("Copyright", `report:reason:${id}:copyright`), inlineButton("Inappropriate", `report:reason:${id}:inappropriate`)], [inlineButton("Spam", `report:reason:${id}:spam`), inlineButton("Other", `report:reason:${id}:other`)]]) });
});
composer.callbackQuery(/^report:reason:([^:]+):([^:]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "report-details"; ctx.session.reportImageId = ctx.match[1]; ctx.session.reportReason = ctx.match[2];
  await ctx.reply("Add details to help the curator, or reply Skip.", forceReply("What should the curator know?"));
});
async function readyToSubmit(ctx: Ctx, details = "") { ctx.session.reportDetails = details; ctx.session.step = "report-consent"; await ctx.reply("Should we include your name with this report?", { reply_markup: inlineKeyboard([[inlineButton("Include my name", "report:submit:you"), inlineButton("Keep it anonymous", "report:submit:anon")]]) }); }
composer.callbackQuery("report:details:skip", async (ctx) => { await ctx.answerCallbackQuery(); await readyToSubmit(ctx); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.step !== "report-details") return next(); const details = ctx.message.text.trim(); await readyToSubmit(ctx, details.toLocaleLowerCase() === "skip" ? "" : details.slice(0, 500)); });
composer.callbackQuery(/^report:submit:(you|anon)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const store = await GalleryStore.open(ctx); const imageId = ctx.session.reportImageId, reason = ctx.session.reportReason;
  if (!store || !imageId || !reason) return ctx.reply("That report expired. Open the photo and try again.");
  if (!(await store.reportAllowed(String(ctx.from?.id ?? ctx.chat?.id ?? "anonymous")))) return ctx.reply("Thanks for speaking up. You’ve sent several reports recently, so try again in a little while.");
  await store.addReport({ imageId, reason, details: ctx.session.reportDetails || undefined, reporterId: ctx.match[1] === "you" ? String(ctx.from?.id ?? "") : undefined });
  ctx.session.step = undefined; await notifyOwner(ctx, `New ${reason} report for a gallery photo.`, store);
  await ctx.reply("Thanks — the curator will review this photo.");
});
export default composer;
