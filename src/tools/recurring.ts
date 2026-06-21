import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

// Gera array de datas baseado na frequência
function generateDates(startDate: string, frequency: string, count: number): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T12:00:00Z');

  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    if (frequency === 'daily')   d.setUTCDate(d.getUTCDate() + i);
    if (frequency === 'weekly')  d.setUTCDate(d.getUTCDate() + i * 7);
    if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + i);
    if (frequency === 'yearly')  d.setUTCFullYear(d.getUTCFullYear() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  return dates;
}

export function registerRecurringTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'create_recurring_transaction',
    `Cria um lançamento recorrente no Fincore.
    
IMPORTANTE — como a recorrência funciona:
- Todos os lançamentos são criados imediatamente no banco
- Indeterminado: cria 12 lançamentos (janela de 12 meses)
- Fixed N parcelas: cria exatamente N lançamentos
- Cada lançamento tem sua própria data calculada a partir do start_date
- O start_date DEVE incluir o dia exato (YYYY-MM-DD), ex: 2026-07-05
- Para mensal no dia 5: start_date=2026-07-05, cria 2026-07-05, 2026-08-05, etc.
- Todos criados com status=pending — usuário confirma pagamento mês a mês`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      description: z.string().describe('Descrição do lançamento'),
      amount: z.number().positive().describe('Valor em reais'),
      type: z.enum(['income', 'expense']).describe('Tipo: income (receita) ou expense (despesa)'),
      start_date: z.string().describe('Data de início COMPLETA com dia (YYYY-MM-DD) ex: 2026-07-05. O dia determina o dia de vencimento mensal.'),
      frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('Frequência: daily, weekly, monthly ou yearly'),
      duration_type: z.enum(['indeterminate', 'fixed']).default('indeterminate').describe('indeterminate = sem fim (cria 12 meses), fixed = número fixo de parcelas'),
      recurrence_count: z.number().int().positive().optional().describe('Número de parcelas — obrigatório quando duration_type=fixed'),
      category_id: z.string().uuid().optional().describe('ID da categoria'),
      bank_account_id: z.string().uuid().optional().describe('ID da conta bancária'),
      payment_method_id: z.string().uuid().optional().describe('ID da forma de pagamento'),
      supplier_id: z.string().uuid().optional().describe('ID do fornecedor'),
      client_id: z.string().uuid().optional().describe('ID do cliente'),
      notes: z.string().optional().describe('Observações'),
    },
    async ({
      entity_id, description, amount, type, start_date,
      frequency, duration_type, recurrence_count,
      category_id, bank_account_id, payment_method_id,
      supplier_id, client_id, notes
    }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      if (duration_type === 'fixed' && !recurrence_count) {
        throw new Error('recurrence_count é obrigatório quando duration_type é fixed');
      }

      // Quantos lançamentos materializar
      const totalCount = duration_type === 'fixed' ? recurrence_count! : 12;

      // Calcula end_date
      let end_date: string | null = null;
      if (duration_type === 'fixed' && recurrence_count) {
        const dates = generateDates(start_date, frequency, recurrence_count);
        end_date = dates[dates.length - 1];
      }

      const day_of_month = frequency === 'monthly' || frequency === 'yearly'
        ? new Date(start_date + 'T12:00:00Z').getUTCDate()
        : null;

      const day_of_week = frequency === 'weekly'
        ? new Date(start_date + 'T12:00:00Z').getUTCDay()
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

      // 2. Gera todas as datas
      const allDates = generateDates(start_date, frequency, totalCount);

      // 3. Monta os lançamentos para insert em batch
      const rows = allDates.map((date, index) => ({
        entity_id,
        description,
        amount,
        net_amount: amount,
        type,
        date,
        status: 'pending',
        recurrence_type: 'none',
        recurrence_rule_id: rule.id,
        installments: duration_type === 'fixed' ? recurrence_count : null,
        current_installment: duration_type === 'fixed' ? index + 1 : null,
        category_id: category_id ?? null,
        bank_account_id: bank_account_id ?? null,
        payment_method_id: payment_method_id ?? null,
        supplier_id: supplier_id ?? null,
        client_id: client_id ?? null,
        notes: notes ?? null,
      }));

      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .insert(rows)
        .select('id, date, current_installment');

      if (txError) {
        // Rollback da rule
        await supabase.from('recurrence_rules').delete().eq('id', rule.id);
        throw new Error(txError.message);
      }

      const freq_label: Record<string, string> = {
        daily: 'diariamente',
        weekly: 'semanalmente',
        monthly: 'mensalmente',
        yearly: 'anualmente',
      };

      const duracao = duration_type === 'fixed'
        ? `${recurrence_count} parcelas`
        : '12 meses (indeterminado)';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Lançamento recorrente "${description}" de R$ ${amount.toFixed(2)} criado. ${totalCount} lançamentos materializados ${freq_label[frequency]} a partir de ${start_date}.`,
            recurrence_rule_id: rule.id,
            total_created: (transactions ?? []).length,
            first_date: allDates[0],
            last_date: allDates[allDates.length - 1],
            transactions_created: transactions ?? [],
          }, null, 2),
        }],
      };
    }
  );
}
