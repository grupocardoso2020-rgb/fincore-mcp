import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerReportTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'get_summary',
    'Retorna resumo financeiro de uma entidade em um mês',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      year: z.number().int().describe('Ano (ex: 2026)'),
      month: z.number().int().min(1).max(12).describe('Mês (1-12)'),
    },
    async ({ entity_id, year, month }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const date_from = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const date_to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

      const { data, error } = await supabase
        .from('transactions')
        .select('amount, type, status')
        .eq('entity_id', entity_id)
        .gte('date', date_from)
        .lte('date', date_to);

      if (error) throw new Error(error.message);

      const transactions = data ?? [];

      const total_income = transactions
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const total_expense = transactions
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const paid_income = transactions
        .filter((t) => t.type === 'income' && t.status === 'paid')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const paid_expense = transactions
        .filter((t) => t.type === 'expense' && t.status === 'paid')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const pending_income = transactions
        .filter((t) => t.type === 'income' && t.status === 'pending')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const pending_expense = transactions
        .filter((t) => t.type === 'expense' && t.status === 'pending')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { year, month, date_from, date_to },
            summary: {
              total_income,
              total_expense,
              balance: total_income - total_expense,
              paid_income,
              paid_expense,
              real_balance: paid_income - paid_expense,
              pending_income,
              pending_expense,
              transaction_count: transactions.length,
            },
          }, null, 2),
        }],
      };
    }
  );
}
