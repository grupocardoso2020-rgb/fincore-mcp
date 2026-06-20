import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerRecurringTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'create_recurring_transaction',
    'Cria um lançamento recorrente (diário, semanal, mensal ou anual) no Fincore',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      description: z.string().describe('Descrição do lançamento'),
      amount: z.number().positive().describe('Valor em reais'),
      type: z.enum(['income', 'expense']).describe('Tipo: income (receita) ou expense (despesa)'),
      start_date: z.string().describe('Data de início da recorrência (YYYY-MM-DD)'),
      frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('Frequência: daily, weekly, monthly ou yearly'),
      duration_type: z.enum(['indeterminate', 'fixed']).default('indeterminate').describe('Duração: indeterminate (sem fim) ou fixed (número fixo)'),
      recurrence_count: z.number().int().positive().optional().describe('Número de repetições — obrigatório quando duration_type=fixed'),
      category_id: z.string().uuid().optional().describe('ID da categoria — use get_categories para obter'),
      bank_account_id: z.string().uuid().optional().describe('ID da conta bancária — use get_bank_accounts para obter'),
      payment_method_id: z.string().uuid().optional().describe('ID da forma de pagamento — use get_payment_methods para obter'),
      supplier_id: z.string().uuid().optional().describe('ID do fornecedor — use get_suppliers para obter'),
      notes: z.string().optional().describe('Observações adicionais'),
    },
    async ({
      entity_id, description, amount, type, start_date,
      frequency, duration_type, recurrence_count,
      category_id, bank_account_id, payment_method_id,
      supplier_id, notes
    }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      // Valida: se fixed, precisa de recurrence_count
      if (duration_type === 'fixed' && !recurrence_count) {
        throw new Error('recurrence_count é obrigatório quando duration_type é fixed');
      }

      // Calcula end_date se fixed
      let end_date: string | null = null;
      if (duration_type === 'fixed' && recurrence_count) {
        const start = new Date(start_date);
        if (frequency === 'daily') {
          start.setDate(start.getDate() + recurrence_count - 1);
        } else if (frequency === 'weekly') {
          start.setDate(start.getDate() + (recurrence_count - 1) * 7);
        } else if (frequency === 'monthly') {
          start.setMonth(start.getMonth() + recurrence_count - 1);
        } else if (frequency === 'yearly') {
          start.setFullYear(start.getFullYear() + recurrence_count - 1);
        }
        end_date = start.toISOString().split('T')[0];
      }

      // Extrai day_of_month para recorrência mensal
      const day_of_month = frequency === 'monthly'
        ? new Date(start_date).getDate()
        : null;

      // Extrai day_of_week para recorrência semanal (0=domingo)
      const day_of_week = frequency === 'weekly'
        ? new Date(start_date).getDay()
        : null;

      // 1. Cria a recurrence_rule
      const { data: rule, error: ruleError } = await supabase
        .from('recurrence_rules')
        .insert({
          entity_id,
          frequency,
          interval_count: 1,
          day_of_month,
          day_of_week,
          start_date,
          end_date,
          is_active: true,
          type: 'recurring',
        })
        .select()
        .single();

      if (ruleError) throw new Error(ruleError.message);

      // 2. Cria a transação template vinculada à regra
      const { data: transaction, error: txError } = await supabase
        .from('transactions')
        .insert({
          entity_id,
          description,
          amount,
          net_amount: amount,
          type,
          date: start_date,
          status: 'pending',
          recurrence_type: frequency,
          recurrence_rule_id: rule.id,
          installments: recurrence_count ?? null,
          current_installment: 1,
          category_id: category_id ?? null,
          bank_account_id: bank_account_id ?? null,
          payment_method_id: payment_method_id ?? null,
          supplier_id: supplier_id ?? null,
          notes: notes ?? null,
        })
        .select()
        .single();

      if (txError) {
        // Rollback da rule se a transação falhar
        await supabase.from('recurrence_rules').delete().eq('id', rule.id);
        throw new Error(txError.message);
      }

      const duracao = duration_type === 'fixed'
        ? `${recurrence_count} vezes`
        : 'indefinidamente';

      const freq_label: Record<string, string> = {
        daily: 'diariamente',
        weekly: 'semanalmente',
        monthly: 'mensalmente',
        yearly: 'anualmente',
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Lançamento recorrente "${description}" de R$ ${amount.toFixed(2)} criado. Será repetido ${freq_label[frequency]} ${duracao} a partir de ${start_date}.`,
            recurrence_rule: rule,
            transaction_template: transaction,
          }, null, 2),
        }],
      };
    }
  );
}
