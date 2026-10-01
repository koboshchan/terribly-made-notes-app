import { RequestError } from './request-limits';
import { allowedProviderUrl } from './provider-url';
import { reserveUsage } from './usage';

export function validateChat(body: any) {
  if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) throw new RequestError('Message must be between 1 and 4000 characters');
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 20 || history.some((m: any) => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 4000) || history.reduce((size: number, m: any) => size + m.content.length, 0) > 24000) throw new RequestError('Invalid or oversized chat history');
  return { message: body.message.trim() as string, history: history as { role: 'user' | 'assistant'; content: string }[] };
}

export async function publicChatUsage(request: Request, token: string, ownerId: string) {
  // Avoid trusting forwarded IPs from unconfigured proxies. Unknown clients share
  // one conservative bucket. Operators must configure the trusted proxy header.
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const ip = header ? (request.headers.get(header)?.split(',')[0].trim() || 'unknown').slice(0, 128) : 'unknown';
  await reserveUsage(`public-chat-ip:${ip}`, 20, 60000);
  await reserveUsage(`public-chat-token:${token}`, 10, 60000);
  await reserveUsage(`public-chat-owner:${ownerId}`, Number(process.env.PUBLIC_CHAT_DAILY_REQUESTS) || 100, 86400000);
}

export async function chatCompletion(settings: any, messages: { role: string; content: string }[]): Promise<string> {
  const baseUrl = allowedProviderUrl(settings.baseUrl);
  if (!baseUrl) throw new Error('Provider endpoint is not approved in deployment configuration');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    // Chat deliberately does not retry uncertain failures and potentially charge twice.
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` }, body: JSON.stringify({ model: settings.chatModel, messages, temperature: 0.7, max_tokens: 2000 }) });
    if (!response.ok) throw new Error(`Chat provider returned ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) throw new Error('Empty provider response');
    return content;
  } finally { clearTimeout(timer); }
}
