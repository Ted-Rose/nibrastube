// Fire-and-forget admin notification, currently Telegram-only: set
// TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable. Silently no-ops
// without them so dev/preview environments don't spam the admin chat.
export async function notifyAdmin(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("Admin notification failed:", err);
  }
}
