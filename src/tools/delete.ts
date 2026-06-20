import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerDeleteTools(server: McpServer, getAuth: () => AuthContext) {

  server.tool(
    'delete_transaction',
    'Apaga um lançamento financeiro pelo ID. Use apenas quando o usuário confirmar explicitamente que quer deletar.',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      transaction_id: z.string().uuid().describe('ID do lançamento a ser apagado'),
    },
    async ({ entity_id, transaction_id }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      // Verifica se o lançamento pertence à entidade antes de deletar
      const { data: existing, error: fetchError } = await supabase
        .from('transactions')
        .select('id, description, amount, type')
        .eq('id', transaction_id)
        .eq('entity_id', entity_id)
        .single();

      if (fetchError || !existing) {
        throw new Error('Lançamento não encontrado ou não pertence a esta entidade');
      }

      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', transaction_id)
        .eq('entity_id', entity_id);

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Lançamento "${existing.description}" de R$ ${existing.amount.toFixed(2)} apagado com sucesso.`,
            deleted: existing,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'delete_calendar_event',
    'Apaga um agendamento do calendário pelo ID. Use apenas quando o usuário confirmar explicitamente.',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      event_id: z.string().uuid().describe('ID do agendamento a ser apagado'),
    },
    async ({ entity_id, event_id }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      // Verifica se o evento pertence à entidade
      const { data: existing, error: fetchError } = await supabase
        .from('calendar_events')
        .select('id, title, date, time')
        .eq('id', event_id)
        .eq('entity_id', entity_id)
        .single();

      if (fetchError || !existing) {
        throw new Error('Agendamento não encontrado ou não pertence a esta entidade');
      }

      // Apaga lembretes vinculados primeiro
      await supabase
        .from('calendar_reminders')
        .delete()
        .eq('event_id', event_id);

      const { error } = await supabase
        .from('calendar_events')
        .delete()
        .eq('id', event_id)
        .eq('entity_id', entity_id);

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Agendamento "${existing.title}" do dia ${existing.date}${existing.time ? ' às ' + existing.time : ''} apagado com sucesso.`,
            deleted: existing,
          }, null, 2),
        }],
      };
    }
  );
}
