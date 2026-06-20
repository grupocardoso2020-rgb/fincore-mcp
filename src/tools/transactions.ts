import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerTransactionTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'get_transactions',
    'Busca lançamentos financeiros de uma entidade por período',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date_from: z.string().describe('Data inicial (YYYY-MM-DD)'),
      date_to: z.string().describe('Data final (YYYY-MM-DD)'),
      type: z.enum(['income', 'expense']).optional().describe('Filtrar por tipo: income ou expense'),
      status: z.string().optional().describe('Filtrar por status: paid, pending, overdue'),
    },
    async ({ entity_id, date_from, date_to, type, status }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      let query = supabase
        .from('transactions')
        .select(`
          id, description, amount, type, status,
          date, due_date, paid_date, notes,
          category_id, bank_account_id
        `)
        .eq('entity_id', entity_id)
        .gte('date', date_from)
        .lte('date', date_to)
        .order('date', { ascending: false });

      if (type) query = query.eq('type', type);
      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const total_income = (data ?? [])
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const total_expense = (data ?? [])
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { from: date_from, to: date_to },
            summary: {
              total_income,
              total_expense,
              balance: total_income - total_expense,
              count: (data ?? []).length,
            },
            transactions: data ?? [],
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'create_transaction',
    'Cria um novo lançamento financeiro',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      description: z.string().describe('Descrição do lançamento'),
      amount: z.number().positive().describe('Valor em reais'),
      type: z.enum(['income', 'expense']).describe('Tipo: income (receita) ou expense (despesa)'),
      date: z.string().describe('Data do lançamento (YYYY-MM-DD)'),
      status: z.enum(['paid', 'pending']).default('paid').describe('Status: paid ou pending'),
      category_id: z.string().uuid().optional().describe('ID da categoria'),
      bank_account_id: z.string().uuid().optional().describe('ID da conta bancária'),
      notes: z.string().optional().describe('Observações'),
    },
    async ({ entity_id, description, amount, type, date, status, category_id, bank_account_id, notes }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          entity_id,
          description,
          amount,
          type,
          date,
          status,
          category_id: category_id ?? null,
          bank_account_id: bank_account_id ?? null,
          notes: notes ?? null,
          recurrence_type: 'none',
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Lançamento "${description}" de R$ ${amount.toFixed(2)} criado com sucesso.`,
            transaction: data,
          }, null, 2),
        }],
      };
    }
  );
}
