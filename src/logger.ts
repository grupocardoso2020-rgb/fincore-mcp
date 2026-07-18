import { supabase } from './supabase.js';

interface McpLogEntry {
  user_id: string;
  platform: 'claude' | 'chatgpt';
  endpoint: string;
  tool_name?: string;
  status: 'success' | 'error';
  error_message?: string;
  response_time_ms?: number;
  ip_address?: string;
}

/**
 * Grava log de requisição MCP/GPT Actions no banco.
 * Fire-and-forget — nunca bloqueia a resposta ao cliente.
 */
export function logMcpRequest(entry: McpLogEntry): void {
  supabase
    .from('mcp_request_logs')
    .insert(entry)
    .then(({ error }) => {
      if (error) console.error('[logger] Falha ao gravar log:', error.message);
    })
    .catch((err) => {
      console.error('[logger] Exceção ao gravar log:', err);
    });
}

/**
 * Extrai o IP do cliente a partir do request Express.
 */
export function getClientIp(req: { headers: Record<string, any>; socket?: { remoteAddress?: string } }): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
