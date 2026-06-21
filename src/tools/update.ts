import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerUpdateTools(server: McpServer, getAuth: () => AuthContext) {

  server.tool(
    'update_transaction',
    `Edita um lançamento financeiro existente.
Para lançamentos recorrentes, use o parâmetro scope:
- only: edita só este lançamento
- future: edita este e todos os futuros pendentes
- all: edita todos os pendentes da série`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      transaction_id: z.string().uuid().describe('ID do lançamento'),
      scope: z.enum(['only', 'future', 'all']).default('only').describe('Escopo de edição para recorrentes: only, future ou all'),
      description: z.string().optional().describe('Nova descrição'),
      amount: z.number().positive().optional().describe('Novo valor em reais'),
      date: z.string().optional().describe('Nova data (YYYY-MM-DD)'),
      due_date: z.string().optional().describe('Nova data de vencimento (YYYY-MM-DD)'),
      status: z.enum(['paid', 'pending', 'cancelled']).optional().describe('Novo status'),
      paid_date: z.string().optional().describe('Data de pagamento (YYYY-MM-DD)'),
      category_id: z.string().uuid().optional().describe('ID da nova categoria'),
      bank_account_id: z.string().uuid().optional().describe('ID da nova conta bancária'),
      payment_method_id: z.string().uuid().optional().describe('ID da nova forma de pagamento'),
      supplier_id: z.string().uuid().optional().describe('ID do fornecedor'),
      client_id: z.string().uuid().optional().describe('ID do cliente'),
      notes: z.string().optional().describe('Observações'),
    },
    async ({
      entity_id, transaction_id, scope,
      description, amount, date, due_date, status, paid_date,
      category_id, bank_account_id, payment_method_id,
      supplier_id, client_id, notes
    }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      // Busca o lançamento
      const { data: existing, error: fetchError } = await supabase
        .from('transactions')
        .select('id, description, amount, recurrence_rule_id, date, status')
        .eq('id', transaction_id)
        .eq('entity_id', entity_id)
        .single();

      if (fetchError || !existing) {
        throw new Error('Lançamento não encontrado ou não pertence a esta entidade');
      }

      // Monta update do lançamento atual
      const updateData: any = {};
      if (description !== undefined) updateData.description = description;
      if (amount !== undefined) { updateData.amount = amount; updateData.net_amount = amount; }
      if (date !== undefined) updateData.date = date;
      if (due_date !== undefined) updateData.due_date = due_date;
      if (status !== undefined) updateData.status = status;
      if (status === 'paid') updateData.paid_date = paid_date ?? new Date().toISOString().split('T')[0];
      if (category_id !== undefined) updateData.category_id = category_id;
      if (bank_account_id !== undefined) updateData.bank_account_id = bank_account_id;
      if (payment_method_id !== undefined) updateData.payment_method_id = payment_method_id;
      if (supplier_id !== undefined) updateData.supplier_id = supplier_id;
      if (client_id !== undefined) updateData.client_id = client_id;
      if (notes !== undefined) updateData.notes = notes;

      if (Object.keys(updateData).length === 0) {
        throw new Error('Nenhum campo para atualizar foi informado');
      }

      // Atualiza o lançamento atual
      const { error: updateError } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', transaction_id)
        .eq('entity_id', entity_id);

      if (updateError) throw new Error(updateError.message);

      // Se tem recurrence_rule_id e scope != 'only', propaga para os demais
      if (existing.recurrence_rule_id && scope !== 'only') {
        // Campos propagáveis para a série
        const propagateData: any = {};
        if (description !== undefined) propagateData.description = description;
        if (amount !== undefined) { propagateData.amount = amount; propagateData.net_amount = amount; }
        if (category_id !== undefined) propagateData.category_id = category_id;
        if (bank_account_id !== undefined) propagateData.bank_account_id = bank_account_id;
        if (payment_method_id !== undefined) propagateData.payment_method_id = payment_method_id;
        if (supplier_id !== undefined) propagateData.supplier_id = supplier_id;
        if (client_id !== undefined) propagateData.client_id = client_id;

        if (Object.keys(propagateData).length > 0) {
          let seriesQuery = supabase
            .from('transactions')
            .update(propagateData)
            .eq('recurrence_rule_id', existing.recurrence_rule_id)
            .eq('entity_id', entity_id)
            .eq('status', 'pending')
            .neq('id', transaction_id);

          if (scope === 'future') {
            seriesQuery = seriesQuery.gte('date', existing.date);
          }

          const { error: seriesError } = await seriesQuery;
          if (seriesError) throw new Error(seriesError.message);
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: scope === 'only'
              ? `Lançamento atualizado com sucesso.`
              : `Lançamento e ${scope === 'future' ? 'futuros pendentes' : 'todos os pendentes da série'} atualizados com sucesso.`,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'update_calendar_event',
    'Edita um agendamento existente no calendário',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      event_id: z.string().uuid().describe('ID do agendamento'),
      title: z.string().optional().describe('Novo título'),
      description: z.string().optional().describe('Nova descrição'),
      date: z.string().optional().describe('Nova data (YYYY-MM-DD)'),
      time: z.string().optional().describe('Novo horário (HH:MM) — passar string vazia para remover'),
      status: z.enum(['pending', 'done', 'missed', 'cancelled']).optional().describe('Novo status'),
      color: z.string().optional().describe('Nova cor em hex (ex: #3b82f6)'),
      notes: z.string().optional().describe('Notas/anotações'),
      reminder_minutes: z.number().int().positive().optional().describe('Adicionar lembrete em minutos antes do evento (ex: 30, 60, 1440)'),
    },
    async ({
      entity_id, event_id, title, description, date, time,
      status, color, notes, reminder_minutes
    }) => {
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

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (date !== undefined) updateData.date = date;
      if (time !== undefined) updateData.time = time === '' ? null : time;
      if (status !== undefined) updateData.status = status;
      if (color !== undefined) updateData.color = color;
      if (notes !== undefined) updateData.notes = notes;

      if (Object.keys(updateData).length === 0 && !reminder_minutes) {
        throw new Error('Nenhum campo para atualizar foi informado');
      }

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabase
          .from('calendar_events')
          .update(updateData)
          .eq('id', event_id)
          .eq('entity_id', entity_id);

        if (error) throw new Error(error.message);
      }

      // Cria lembrete se solicitado
      let reminder = null;
      if (reminder_minutes) {
        const finalDate = date ?? existing.date;
        const finalTime = time !== undefined ? (time === '' ? null : time) : existing.time;

        let remind_at: string | null = null;
        if (finalDate && finalTime) {
          const eventDateTime = new Date(`${finalDate}T${finalTime}:00`);
          eventDateTime.setMinutes(eventDateTime.getMinutes() - reminder_minutes);
          remind_at = eventDateTime.toISOString();
        }

        const { data: rem } = await supabase
          .from('calendar_reminders')
          .insert({ event_id, minutes_before: reminder_minutes, remind_at, is_notified: false })
          .select()
          .single();

        reminder = rem;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Agendamento "${title ?? existing.title}" atualizado com sucesso.${reminder ? ` Lembrete de ${reminder_minutes} minutos criado.` : ''}`,
          }, null, 2),
        }],
      };
    }
  );
}
