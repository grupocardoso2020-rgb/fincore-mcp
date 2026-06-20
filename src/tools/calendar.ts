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

  // Update status de agendamento
  server.tool(
    'update_calendar_event_status',
    'Atualiza o status de um agendamento (concluído, perdido, cancelado)',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      event_id: z.string().uuid().describe('ID do agendamento'),
      status: z.enum(['pending', 'done', 'missed', 'cancelled']).describe('Novo status do agendamento'),
    },
    async ({ entity_id, event_id, status }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data: existing, error: fetchError } = await supabase
        .from('calendar_events')
        .select('id, title, date')
        .eq('id', event_id)
        .eq('entity_id', entity_id)
        .single();

      if (fetchError || !existing) {
        throw new Error('Agendamento não encontrado ou não pertence a esta entidade');
      }

      const { error } = await supabase
        .from('calendar_events')
        .update({ status })
        .eq('id', event_id)
        .eq('entity_id', entity_id);

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Agendamento "${existing.title}" do dia ${existing.date} atualizado para ${status}.`,
          }, null, 2),
        }],
      };
    }
  );

  // Criar lembrete
  server.tool(
    'create_calendar_reminder',
    'Cria um lembrete para um agendamento existente',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      event_id: z.string().uuid().describe('ID do agendamento'),
      minutes_before: z.number().int().positive().default(30).describe('Minutos antes do evento para lembrar (ex: 15, 30, 60, 1440 para 1 dia antes)'),
    },
    async ({ entity_id, event_id, minutes_before }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data: existing, error: fetchError } = await supabase
        .from('calendar_events')
        .select('id, title, date, time')
        .eq('id', event_id)
        .eq('entity_id', entity_id)
        .single();

      if (fetchError || !existing) {
        throw new Error('Agendamento não encontrado ou não pertence a esta entidade');
      }

      // Calcula remind_at baseado na data/hora do evento
      let remind_at: string | null = null;
      if (existing.date && existing.time) {
        const eventDateTime = new Date(`${existing.date}T${existing.time}:00`);
        eventDateTime.setMinutes(eventDateTime.getMinutes() - minutes_before);
        remind_at = eventDateTime.toISOString();
      }

      const { data, error } = await supabase
        .from('calendar_reminders')
        .insert({
          event_id,
          minutes_before,
          remind_at,
          is_notified: false,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Lembrete criado: ${minutes_before} minutos antes de "${existing.title}" no dia ${existing.date}.`,
            reminder: data,
          }, null, 2),
        }],
      };
    }
  );
}
