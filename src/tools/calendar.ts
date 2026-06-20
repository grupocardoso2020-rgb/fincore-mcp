import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerCalendarTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'create_calendar_event',
    'Cria um agendamento no calendário do Fincore',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      title: z.string().describe('Título do agendamento'),
      date: z.string().describe('Data do evento (YYYY-MM-DD)'),
      time: z.string().optional().describe('Horário (HH:MM) — omitir para evento de dia inteiro'),
      description: z.string().optional().describe('Descrição ou observações'),
      color: z.string().optional().describe('Cor do evento em hex (ex: #3b82f6)'),
    },
    async ({ entity_id, title, date, time, description, color }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('calendar_events')
        .insert({
          entity_id,
          title,
          date,
          time: time ?? null,
          description: description ?? null,
          color: color ?? '#3b82f6',
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Agendamento "${title}" criado para ${date}${time ? ' às ' + time : ''}.`,
            event: data,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_calendar_events',
    'Lista agendamentos de uma entidade por período',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date_from: z.string().describe('Data inicial (YYYY-MM-DD)'),
      date_to: z.string().describe('Data final (YYYY-MM-DD)'),
    },
    async ({ entity_id, date_from, date_to }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, date, time, description, color, status')
        .eq('entity_id', entity_id)
        .gte('date', date_from)
        .lte('date', date_to)
        .order('date')
        .order('time');

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ events: data ?? [] }, null, 2),
        }],
      };
    }
  );
}
