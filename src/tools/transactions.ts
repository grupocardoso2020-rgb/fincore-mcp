import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerTransactionTools(server: McpServer, getAuth: () => AuthContext) {

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
          payment_method_id, supplier_id, client_id
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
    `Cria um novo lançamento financeiro (receita ou despesa).

CAMPOS OBRIGATÓRIOS PARA TODOS:
- entity_id, description, amount, type, date, status, category_id, bank_account_id

OBRIGATÓRIO APENAS PARA RECEITA (income):
- payment_method_id: forma de pagamento (PIX, cartão, boleto, etc.)

OPCIONAIS:
- supplier_id: fornecedor (despesas)
- client_id: cliente (receitas)
- due_date: data de vencimento (quando status=pending)
- notes: observações

FLUXO OBRIGATÓRIO antes de criar:
1. Chamar get_categories para obter category_id
2. Chamar get_bank_accounts para obter bank_account_id
3. Para receitas: chamar get_payment_methods para obter payment_method_id
4. Só então criar o lançamento com todos os IDs corretos`,
    {
      entity_id: z.string().uuid().describe('ID da entidade — obrigatório'),
      description: z.string().describe('Descrição do lançamento — obrigatório'),
      amount: z.number().positive().describe('Valor em reais — obrigatório'),
      type: z.enum(['income', 'expense']).describe('Tipo: income (receita) ou expense (despesa) — obrigatório'),
      date: z.string().describe('Data do lançamento (YYYY-MM-DD) — obrigatório'),
      status: z.enum(['paid', 'pending']).describe('Status: paid (pago) ou pending (pendente) — obrigatório'),
      category_id: z.string().uuid().describe('ID da categoria — OBRIGATÓRIO — use get_categories'),
      bank_account_id: z.string().uuid().describe('ID da conta bancária — OBRIGATÓRIO — use get_bank_accounts'),
      payment_method_id: z.string().uuid().optional().describe('ID da forma de pagamento — OBRIGATÓRIO para receitas — use get_payment_methods'),
      supplier_id: z.string().uuid().optional().describe('ID do fornecedor (opcional, despesas) — use get_suppliers'),
      client_id: z.string().uuid().optional().describe('ID do cliente (opcional, receitas) — use get_clients'),
      due_date: z.string().optional().describe('Data de vencimento (YYYY-MM-DD) — para lançamentos pendentes'),
      notes: z.string().optional().describe('Observações adicionais'),
    },
    async ({
      entity_id, description, amount, type, date, status,
      category_id, bank_account_id, payment_method_id,
      supplier_id, client_id, due_date, notes
    }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      // Validações obrigatórias
      if (!category_id) {
        throw new Error('category_id é obrigatório. Use get_categories para obter o ID correto.');
      }
      if (!bank_account_id) {
        throw new Error('bank_account_id é obrigatório. Use get_bank_accounts para obter o ID correto.');
      }
      if (type === 'income' && !payment_method_id) {
        throw new Error('payment_method_id é obrigatório para receitas. Use get_payment_methods para obter o ID correto.');
      }

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          entity_id,
          description,
          amount,
          net_amount: amount,
          type,
          date,
          status,
          category_id,
          bank_account_id,
          payment_method_id: payment_method_id ?? null,
          supplier_id: supplier_id ?? null,
          client_id: client_id ?? null,
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

  server.tool(
    'update_transaction_status',
    'Atualiza o status de um lançamento (pago, pendente, cancelado)',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      transaction_id: z.string().uuid().describe('ID do lançamento'),
      status: z.enum(['paid', 'pending', 'cancelled']).describe('Novo status'),
      paid_date: z.string().optional().describe('Data de pagamento (YYYY-MM-DD) — obrigatório quando status=paid'),
    },
    async ({ entity_id, transaction_id, status, paid_date }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data: existing, error: fetchError } = await supabase
        .from('transactions')
        .select('id, description, amount, status')
        .eq('id', transaction_id)
        .eq('entity_id', entity_id)
        .single();

      if (fetchError || !existing) {
        throw new Error('Lançamento não encontrado ou não pertence a esta entidade');
      }

      const updateData: any = { status };
      if (status === 'paid') {
        updateData.paid_date = paid_date ?? new Date().toISOString().split('T')[0];
      }

      const { error } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', transaction_id)
        .eq('entity_id', entity_id);

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Lançamento "${existing.description}" atualizado para ${status}.`,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_clients',
    'Lista clientes de uma entidade',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      search: z.string().optional().describe('Filtrar por nome (opcional)'),
    },
    async ({ entity_id, search }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      let query = supabase
        .from('clients')
        .select('id, name, email, phone, document')
        .eq('entity_id', entity_id)
        .order('name');

      if (search) query = query.ilike('name', `%${search}%`);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ clients: data ?? [] }, null, 2),
        }],
      };
    }
  );
}
