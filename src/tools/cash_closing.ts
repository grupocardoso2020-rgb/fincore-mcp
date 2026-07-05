import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerCashClosingTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'create_cash_closing',
    `Cria uma Apuração Financeira (fechamento de caixa/turno) no Fincore.

IMPORTANTE:
- Cria em status "draft" — a conversão para lançamentos financeiros é feita manualmente pelo usuário na tela.
- "Dinheiro (calculado)" e "Diferença" são calculados automaticamente pelo servidor, não precisam ser informados.
- payments[] são as formas de pagamento NÃO-dinheiro (cartão, pix, etc). Use get_payment_methods para obter os IDs corretos.
- movements[] são entradas ('in', ex: saldo inicial/troco) e saídas ('out', ex: despesas pagas do caixa) durante o turno.
- Fórmula: calculated_cash = (total_sales - soma(payments)) + soma(movements tipo 'in') - soma(movements tipo 'out')`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date: z.string().describe('Data da apuração (YYYY-MM-DD)'),
      shift_label: z.string().optional().describe('Turno, ex: Manhã, Noite, Caixa 1'),
      responsible: z.string().optional().describe('Nome do responsável pelo turno'),
      total_sales: z.number().positive().describe('Total de vendas do turno — obrigatório, deve ser maior que zero'),
      payments: z.array(z.object({
        payment_method_id: z.string().uuid().describe('ID da forma de pagamento — use get_payment_methods'),
        amount: z.number().describe('Valor recebido nessa forma de pagamento'),
      })).optional().describe('Formas de pagamento não-dinheiro (cartão, pix, etc)'),
      movements: z.array(z.object({
        type: z.enum(['in', 'out']).describe("in = entrada/saldo inicial, out = saída/despesa do caixa"),
        amount: z.number().describe('Valor do movimento'),
        description: z.string().optional().describe('Descrição do movimento'),
      })).optional().describe('Entradas e saídas de caixa durante o turno'),
      counted_cash: z.number().optional().describe('Valor de dinheiro contado fisicamente ao fechar o caixa'),
      notes: z.string().optional().describe('Observações sobre a apuração'),
    },
    async ({ entity_id, date, shift_label, responsible, total_sales, payments, movements, counted_cash, notes }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      if (total_sales <= 0) {
        throw new Error('total_sales deve ser maior que zero');
      }

      const validPayments = (payments ?? []).filter((p) => p.amount > 0);
      const validMovements = (movements ?? []).filter((m) => m.amount > 0);

      const sumOtherPayments = validPayments.reduce((s, p) => s + p.amount, 0);
      const sumIn = validMovements.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
      const sumOut = validMovements.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);

      const calculated_cash = (total_sales - sumOtherPayments) + sumIn - sumOut;
      const difference = counted_cash !== undefined ? counted_cash - calculated_cash : null;

      const { data: closing, error: closingError } = await supabase
        .from('cash_closings')
        .insert({
          entity_id,
          date,
          shift_label: shift_label ?? null,
          responsible: responsible ?? null,
          total_sales,
          calculated_cash,
          counted_cash: counted_cash ?? null,
          difference,
          notes: notes ?? null,
          status: 'draft',
        })
        .select()
        .single();

      if (closingError) throw new Error(closingError.message);

      if (validPayments.length > 0) {
        const { error: paymentsError } = await supabase
          .from('cash_closing_payments')
          .insert(validPayments.map((p) => ({
            cash_closing_id: closing.id,
            payment_method_id: p.payment_method_id,
            amount: p.amount,
          })));

        if (paymentsError) {
          await supabase.from('cash_closings').delete().eq('id', closing.id);
          throw new Error(paymentsError.message);
        }
      }

      if (validMovements.length > 0) {
        const { error: movementsError } = await supabase
          .from('cash_closing_movements')
          .insert(validMovements.map((m) => ({
            cash_closing_id: closing.id,
            type: m.type,
            amount: m.amount,
            description: m.description ?? null,
          })));

        if (movementsError) {
          await supabase.from('cash_closings').delete().eq('id', closing.id);
          throw new Error(movementsError.message);
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Apuração financeira de ${date}${shift_label ? ` (${shift_label})` : ''} criada como rascunho. Dinheiro calculado: R$ ${calculated_cash.toFixed(2)}.${difference !== null ? ` Diferença: R$ ${difference.toFixed(2)} (${difference < 0 ? 'quebra' : difference > 0 ? 'sobra' : 'sem diferença'}).` : ''}`,
            cash_closing: {
              id: closing.id,
              date,
              shift_label: shift_label ?? null,
              responsible: responsible ?? null,
              total_sales,
              calculated_cash,
              counted_cash: counted_cash ?? null,
              difference,
              status: 'draft',
            },
          }, null, 2),
        }],
      };
    }
  );
}
