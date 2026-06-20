import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerTransactionTools(server: McpServer, getAuth: () => AuthContext) {

  // Tool auxiliar — busca fornecedores
  server.tool(
    'get_suppliers',
    'Lista fornecedores de uma entidade para uso ao criar despesas',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      search: z.string().optional().describe('Filtrar por nome (opcional)'),
    },
    async ({ entity_id, search }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      let query = supabase
        .from('suppliers')
        .select('id, name, email, phone')
        .eq('entity_id', entity_id)
        .order('name');

      if (search) query = query.ilike('name', `%${search}%`);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ suppliers: data ?? [] }, null, 2),
        }],
      };
    }
  );

  // Tool auxiliar — busca formas de pagamento
  server.tool(
    'get_payment_methods',
    'Lista formas de pagamento de uma entidade para uso ao criar lançamentos',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
    },
    async ({ entity_id }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, name, status_behavior')
        .eq('entity_id', entity_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ payment_methods: data ?? [] }, null, 2),
        }],
      };
    }
  );

  // Tool principal — busca transações
  server.tool(
    'get_transactions',
    'Busca lançamentos financeiros de uma entidade por período',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date_from: z.string().describe('Data inicial (YYYY-MM-DD)'),
      date_to: z.string().describe('Data final (YYYY-MM-DD)'),
      type: z.enum(['income', 'expense']).optional().describe('Filtrar por tipo'),
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
          category_id, bank_account_id,
          payment_method_id, supplier_id
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

  // Tool principal — cria transação completa
  server.tool(
    'create_transaction',
    'Cria um novo lançamento financeiro (receita ou despesa) com todos os campos disponíveis',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      description: z.string().describe('Descrição do lançamento'),
      amount: z.number().positive().describe('Valor em reais'),
      type: z.enum(['income', 'expense']).describe('Tipo: income (receita) ou expense (despesa)'),
      date: z.string().describe('Data do lançamento (YYYY-MM-DD)'),
      status: z.enum(['paid', 'pending']).default('paid').describe('Status: paid (pago) ou pending (pendente)'),
      category_id: z.string().uuid().optional().describe('ID da categoria — use get_categories para obter'),
      bank_account_id: z.string().uuid().optional().describe('ID da conta bancária — use get_bank_accounts para obter'),
      payment_method_id: z.string().uuid().optional().describe('ID da forma de pagamento — use get_payment_methods para obter'),
      supplier_id: z.string().uuid().optional().describe('ID do fornecedor (apenas para despesas) — use get_suppliers para obter'),
      due_date: z.string().optional().describe('Data de vencimento (YYYY-MM-DD) — para lançamentos pendentes'),
      notes: z.string().optional().describe('Observações adicionais'),
    },
    async ({
      entity_id, description, amount, type, date, status,
      category_id, bank_account_id, payment_method_id,
      supplier_id, due_date, notes
    }) => {
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
          payment_method_id: payment_method_id ?? null,
          supplier_id: supplier_id ?? null,
          due_date: due_date ?? null,
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
