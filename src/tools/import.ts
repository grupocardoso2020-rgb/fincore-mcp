import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

const ImportItemSchema = z.object({
  description: z.string(),
  amount: z.number().positive(),
  type: z.enum(['income', 'expense']),
  date: z.string(),
  status: z.enum(['paid', 'pending']).default('paid'),
  category_id: z.string().uuid().optional(),
});

export function registerImportTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'import_statement',
    'Importa múltiplos lançamentos de um extrato bancário em lote',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      bank_account_id: z.string().uuid().describe('ID da conta bancária de destino'),
      transactions: z.array(ImportItemSchema).min(1).max(200)
        .describe('Lista de lançamentos a importar'),
    },
    async ({ entity_id, bank_account_id, transactions }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const rows = transactions.map((t) => ({
        entity_id,
        bank_account_id,
        description: t.description,
        amount: t.amount,
        type: t.type,
        date: t.date,
        status: t.status,
        category_id: t.category_id ?? null,
        recurrence_type: 'none',
      }));

      const { data, error } = await supabase
        .from('transactions')
        .insert(rows)
        .select('id, description, amount, type, date');

      if (error) throw new Error(error.message);

      const imported = data ?? [];
      const total_income = imported
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const total_expense = imported
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `${imported.length} lançamentos importados com sucesso.`,
            summary: {
              imported_count: imported.length,
              total_income,
              total_expense,
            },
            transactions: imported,
          }, null, 2),
        }],
      };
    }
  );
}
