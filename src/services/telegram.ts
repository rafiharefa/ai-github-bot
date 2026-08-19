export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
}

export class TelegramService {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is not defined.");
    }
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    parseMode: "Markdown" | "HTML" | undefined = "Markdown"
  ): Promise<any> {
    const url = `${this.baseUrl}/sendMessage`;
    const MAX_LENGTH = 3800; // Telegram limit is 4096

    // Split long message if needed
    if (text.length > MAX_LENGTH) {
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_LENGTH) {
          chunks.push(remaining);
          break;
        }
        let splitIdx = remaining.lastIndexOf("\n", MAX_LENGTH);
        if (splitIdx === -1 || splitIdx < 1000) {
          splitIdx = MAX_LENGTH;
        }
        chunks.push(remaining.slice(0, splitIdx));
        remaining = remaining.slice(splitIdx).trim();
      }

      let lastResult: any = null;
      for (const chunk of chunks) {
        lastResult = await this.sendSingleMessage(url, chatId, chunk, parseMode);
      }
      return lastResult;
    }

    return await this.sendSingleMessage(url, chatId, text, parseMode);
  }

  private async sendSingleMessage(
    url: string,
    chatId: number | string,
    text: string,
    parseMode: "Markdown" | "HTML" | undefined
  ): Promise<any> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: false,
        }),
      });

      const data = (await response.json()) as any;
      if (!data?.ok && parseMode) {
        console.warn("[Telegram Service] Parse mode send failed, falling back to plain text:", data?.description);
        const fallbackRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
          }),
        });
        return await fallbackRes.json();
      }
      return data;
    } catch (error) {
      console.error("[Telegram Service Error] Failed to send message:", error);
      throw error;
    }
  }

  async sendChatAction(chatId: number | string, action = "typing"): Promise<void> {
    const url = `${this.baseUrl}/sendChatAction`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          action,
        }),
      });
    } catch {
      // Ignore chat action failures
    }
  }

  async setWebhook(webhookUrl: string): Promise<any> {
    const url = `${this.baseUrl}/setWebhook`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
      }),
    });
    return await response.json();
  }
}
