import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

// Localiza uma apuração por entity_id + date (+ shift_label opcional).
// Retorna { closing } se encontrou exatamente uma, ou { candidates } se
// houver ambiguidade (mais de um turno na mesma data e shift_label não informado).
async function findCashClosing(entity_id: string, date: string, shift_label?: string) {
  let query = supabase
    .from('cash_closings')
    .select('*')
    .eq('entity_id', entity_id)
    .eq('date', date);

  if (shift_label) query = query.eq('shift_label', shift_label);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  if (rows.length === 0) return { closing: null, candidates: null };
  if (rows.length === 1 || shift_label) return { closing: rows[0], candidates: null };
  return { closing: null, candidates: rows };
}

function isEditable(closing: any, payments: any[], movements: any[]) {
  if (closing.status === 'converted') return false;
  if (payments.some((p) => p.transaction_id != null)) return false;
  if (movements.some((m) => m.transaction_id != null)) return false;
  if (closing.conversion_started_at != null) return false;
  return true;
}

export function registerCashClosingTools(server: McpServer, getAuth: () => AuthContext) {
  // ─── CRIAR ───────────────────────────────────────────────────────────────
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

  // ─── LISTAR ──────────────────────────────────────────────────────────────
  server.tool(
    'get_cash_closings',
    `Lista Apurações Financeiras (fechamentos de caixa/turno) de uma entidade, ordenadas da mais recente para a mais antiga.
Use para perguntas como "qual foi a última apuração?" (pegue o primeiro item retornado) ou "apurações de julho" (use date_from/date_to).`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date_from: z.string().optional().describe('Data inicial do filtro (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('Data final do filtro (YYYY-MM-DD)'),
      limit: z.number().int().positive().optional().describe('Máximo de resultados a retornar (padrão: 20)'),
    },
    async ({ entity_id, date_from, date_to, limit }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      let query = supabase
        .from('cash_closings')
        .select('*')
        .eq('entity_id', entity_id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (date_from) query = query.gte('date', date_from);
      if (date_to) query = query.lte('date', date_to);
      query = query.limit(limit ?? 20);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ cash_closings: data ?? [] }, null, 2),
        }],
      };
    }
  );

  // ─── VER DETALHE ─────────────────────────────────────────────────────────
  server.tool(
    'get_cash_closing_detail',
    `Busca o detalhe completo de uma Apuração Financeira específica, incluindo formas de pagamento e movimentos.
Localiza por entity_id + date. Se houver mais de um turno na mesma data, informe shift_label para desambiguar
— se não informar e houver múltiplos, a ferramenta retorna a lista de turnos daquela data para você perguntar ao usuário.`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date: z.string().describe('Data da apuração (YYYY-MM-DD)'),
      shift_label: z.string().optional().describe('Turno — obrigatório apenas se houver mais de uma apuração na mesma data'),
    },
    async ({ entity_id, date, shift_label }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { closing, candidates } = await findCashClosing(entity_id, date, shift_label);

      if (candidates) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              ambiguous: true,
              message: `Há ${candidates.length} apurações em ${date}. Pergunte ao usuário qual turno.`,
              options: candidates.map((c) => ({ shift_label: c.shift_label, responsible: c.responsible, total_sales: c.total_sales, status: c.status })),
            }, null, 2),
          }],
        };
      }

      if (!closing) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, message: `Nenhuma apuração encontrada em ${date}${shift_label ? ` (${shift_label})` : ''}.` }, null, 2),
          }],
        };
      }

      const [{ data: payments, error: paymentsError }, { data: movements, error: movementsError }] = await Promise.all([
        supabase.from('cash_closing_payments').select('*').eq('cash_closing_id', closing.id),
        supabase.from('cash_closing_movements').select('*').eq('cash_closing_id', closing.id),
      ]);

      if (paymentsError) throw new Error(paymentsError.message);
      if (movementsError) throw new Error(movementsError.message);

      const editable = isEditable(closing, payments ?? [], movements ?? []);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            cash_closing: { ...closing, editable },
            payments: payments ?? [],
            movements: movements ?? [],
          }, null, 2),
        }],
      };
    }
  );

  // ─── EDITAR ──────────────────────────────────────────────────────────────
  server.tool(
    'update_cash_closing',
    `Edita uma Apuração Financeira existente. Localiza por entity_id + date (+ shift_label se houver ambiguidade).

BLOQUEIO: não é possível editar uma apuração que já foi convertida (total ou parcialmente) em lançamentos financeiros.
Isso inclui: status já "converted", qualquer item de pagamento/movimento já vinculado a uma transação, ou uma conversão
que foi iniciada mas não terminou. Se bloqueado, informe ao usuário que a apuração não pode mais ser editada.

Campos não informados mantêm o valor atual. payments[]/movements[], se enviados, SUBSTITUEM completamente os existentes
(não é possível editar um item individual da lista — envie a lista completa desejada).
"Dinheiro (calculado)" e "Diferença" são recalculados automaticamente pelo servidor.`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      date: z.string().describe('Data da apuração a editar (YYYY-MM-DD)'),
      shift_label: z.string().optional().describe('Turno — obrigatório apenas se houver mais de uma apuração na mesma data'),
      responsible: z.string().optional().describe('Novo responsável'),
      total_sales: z.number().positive().optional().describe('Novo total de vendas'),
      payments: z.array(z.object({
        payment_method_id: z.string().uuid(),
        amount: z.number(),
      })).optional().describe('Lista completa de formas de pagamento não-dinheiro — substitui a lista existente se enviada'),
      movements: z.array(z.object({
        type: z.enum(['in', 'out']),
        amount: z.number(),
        description: z.string().optional(),
      })).optional().describe('Lista completa de entradas/saídas — substitui a lista existente se enviada'),
      counted_cash: z.number().optional().describe('Novo valor de dinheiro contado'),
      notes: z.string().optional().describe('Novas observações'),
    },
    async ({ entity_id, date, shift_label, responsible, total_sales, payments, movements, counted_cash, notes }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { closing, candidates } = await findCashClosing(entity_id, date, shift_label);

      if (candidates) {
        throw new Error(`Há ${candidates.length} apurações em ${date}. Especifique shift_label: ${candidates.map((c) => c.shift_label).join(', ')}`);
      }
      if (!closing) {
        throw new Error(`Nenhuma apuração encontrada em ${date}${shift_label ? ` (${shift_label})` : ''}.`);
      }

      const [{ data: existingPayments, error: pErr }, { data: existingMovements, error: mErr }] = await Promise.all([
        supabase.from('cash_closing_payments').select('*').eq('cash_closing_id', closing.id),
        supabase.from('cash_closing_movements').select('*').eq('cash_closing_id', closing.id),
      ]);
      if (pErr) throw new Error(pErr.message);
      if (mErr) throw new Error(mErr.message);

      if (!isEditable(closing, existingPayments ?? [], existingMovements ?? [])) {
        throw new Error('Esta apuração já foi convertida (total ou parcialmente) em lançamentos e não pode mais ser editada.');
      }

      const finalTotalSales = total_sales ?? closing.total_sales;
      const finalPayments = payments ?? (existingPayments ?? []).map((p) => ({ payment_method_id: p.payment_method_id, amount: p.amount }));
      const finalMovements = movements ?? (existingMovements ?? []).map((m) => ({ type: m.type, amount: m.amount, description: m.description }));
      const finalCountedCash = counted_cash !== undefined ? counted_cash : closing.counted_cash;

      const validPayments = finalPayments.filter((p) => p.amount > 0);
      const validMovements = finalMovements.filter((m) => m.amount > 0);

      const sumOtherPayments = validPayments.reduce((s, p) => s + p.amount, 0);
      const sumIn = validMovements.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
      const sumOut = validMovements.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);

      const calculated_cash = (finalTotalSales - sumOtherPayments) + sumIn - sumOut;
      const difference = finalCountedCash !== null && finalCountedCash !== undefined ? finalCountedCash - calculated_cash : null;

      const { error: updateError } = await supabase
        .from('cash_closings')
        .update({
          responsible: responsible !== undefined ? responsible : closing.responsible,
          total_sales: finalTotalSales,
          calculated_cash,
          counted_cash: finalCountedCash ?? null,
          difference,
          notes: notes !== undefined ? notes : closing.notes,
          manual_adjustment: true,
          adjusted_at: new Date().toISOString(),
        })
        .eq('id', closing.id);

      if (updateError) throw new Error(updateError.message);

      if (payments !== undefined) {
        const { error: delErr } = await supabase.from('cash_closing_payments').delete().eq('cash_closing_id', closing.id);
        if (delErr) throw new Error(delErr.message);
        if (validPayments.length > 0) {
          const { error: insErr } = await supabase.from('cash_closing_payments').insert(
            validPayments.map((p) => ({ cash_closing_id: closing.id, payment_method_id: p.payment_method_id, amount: p.amount }))
          );
          if (insErr) throw new Error(insErr.message);
        }
      }

      if (movements !== undefined) {
        const { error: delErr } = await supabase.from('cash_closing_movements').delete().eq('cash_closing_id', closing.id);
        if (delErr) throw new Error(delErr.message);
        if (validMovements.length > 0) {
          const { error: insErr } = await supabase.from('cash_closing_movements').insert(
            validMovements.map((m) => ({ cash_closing_id: closing.id, type: m.type, amount: m.amount, description: m.description ?? null }))
          );
          if (insErr) throw new Error(insErr.message);
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Apuração de ${date}${shift_label ? ` (${shift_label})` : ''} atualizada. Dinheiro calculado: R$ ${calculated_cash.toFixed(2)}.${difference !== null ? ` Diferença: R$ ${difference.toFixed(2)} (${difference < 0 ? 'quebra' : difference > 0 ? 'sobra' : 'sem diferença'}).` : ''}`,
            cash_closing: { id: closing.id, date, shift_label: closing.shift_label, total_sales: finalTotalSales, calculated_cash, counted_cash: finalCountedCash ?? null, difference },
          }, null, 2),
        }],
      };
    }
  );
}
