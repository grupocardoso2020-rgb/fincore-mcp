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

      const total_income = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const total_expense = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const paid_income = transactions.filter((t) => t.type === 'income' && t.status === 'paid').reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const paid_expense = transactions.filter((t) => t.type === 'expense' && t.status === 'paid').reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const pending_income = transactions.filter((t) => t.type === 'income' && t.status === 'pending').reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const pending_expense = transactions.filter((t) => t.type === 'expense' && t.status === 'pending').reduce((sum, t) => sum + (t.amount ?? 0), 0);

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

  server.tool(
    'get_financial_indicators',
    'Calcula indicadores financeiros de uma entidade: CMV, CSP, custos fixos, variáveis, margem, lucro líquido',
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

      // Busca transações com classificação financeira da categoria
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          amount, type, status,
          category_id,
          categories!left(financial_classification)
        `)
        .eq('entity_id', entity_id)
        .gte('date', date_from)
        .lte('date', date_to)
        .eq('status', 'paid');

      if (error) throw new Error(error.message);

      const transactions = data ?? [];

      // Receita total
      const receita_total = transactions
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      // Agrupa despesas por financial_classification
      const getClassTotal = (classification: string) =>
        transactions
          .filter((t) => t.type === 'expense' && (t as any).categories?.financial_classification === classification)
          .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const cmv = getClassTotal('cmv');
      const csp = getClassTotal('csp');
      const custos_variaveis = getClassTotal('variable_cost');
      const custos_fixos = getClassTotal('fixed_cost');
      const investimentos = getClassTotal('investment');

      // Despesas sem classificação
      const sem_classificacao = transactions
        .filter((t) => t.type === 'expense' && !(t as any).categories?.financial_classification)
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const despesa_total = cmv + csp + custos_variaveis + custos_fixos + investimentos + sem_classificacao;
      const lucro_bruto = receita_total - cmv - csp;
      const lucro_liquido = receita_total - despesa_total;
      const margem_bruta = receita_total > 0 ? (lucro_bruto / receita_total) * 100 : 0;
      const margem_liquida = receita_total > 0 ? (lucro_liquido / receita_total) * 100 : 0;
      const cmv_percentual = receita_total > 0 ? (cmv / receita_total) * 100 : 0;
      const csp_percentual = receita_total > 0 ? (csp / receita_total) * 100 : 0;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { year, month, date_from, date_to },
            indicators: {
              receita_total: receita_total.toFixed(2),
              despesa_total: despesa_total.toFixed(2),
              lucro_bruto: lucro_bruto.toFixed(2),
              lucro_liquido: lucro_liquido.toFixed(2),
              margem_bruta_percentual: margem_bruta.toFixed(1) + '%',
              margem_liquida_percentual: margem_liquida.toFixed(1) + '%',
              cmv: cmv.toFixed(2),
              cmv_percentual: cmv_percentual.toFixed(1) + '%',
              csp: csp.toFixed(2),
              csp_percentual: csp_percentual.toFixed(1) + '%',
              custos_fixos: custos_fixos.toFixed(2),
              custos_variaveis: custos_variaveis.toFixed(2),
              investimentos: investimentos.toFixed(2),
              sem_classificacao: sem_classificacao.toFixed(2),
            },
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_goals',
    'Lista metas financeiras de uma entidade',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
    },
    async ({ entity_id }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('financial_goals')
        .select('id, title, target_amount, current_amount, target_date, status, color, frequency')
        .eq('entity_id', entity_id)
        .order('target_date');

      if (error) throw new Error(error.message);

      const goals = (data ?? []).map((g) => ({
        ...g,
        progress_percentual: g.target_amount > 0
          ? ((g.current_amount / g.target_amount) * 100).toFixed(1) + '%'
          : '0%',
        remaining: (g.target_amount - g.current_amount).toFixed(2),
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ goals }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_spending_limits',
    'Lista limites de gastos por categoria de uma entidade',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      year: z.number().int().optional().describe('Ano para comparar com gastos reais (ex: 2026)'),
      month: z.number().int().min(1).max(12).optional().describe('Mês para comparar com gastos reais (1-12)'),
    },
    async ({ entity_id, year, month }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data: limits, error } = await supabase
        .from('category_spending_limits')
        .select('id, category_id, amount, categories!left(name, financial_classification)')
        .eq('entity_id', entity_id);

      if (error) throw new Error(error.message);

      // Se informou período, busca gastos reais para comparar
      let spentByCategory: Record<string, number> = {};
      if (year && month) {
        const date_from = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const date_to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

        const { data: txs } = await supabase
          .from('transactions')
          .select('category_id, amount')
          .eq('entity_id', entity_id)
          .eq('type', 'expense')
          .eq('status', 'paid')
          .gte('date', date_from)
          .lte('date', date_to);

        (txs ?? []).forEach((t) => {
          if (t.category_id) {
            spentByCategory[t.category_id] = (spentByCategory[t.category_id] ?? 0) + (t.amount ?? 0);
          }
        });
      }

      const result = (limits ?? []).map((l: any) => {
        const spent = spentByCategory[l.category_id] ?? null;
        return {
          category_id: l.category_id,
          category_name: l.categories?.name ?? 'Sem nome',
          limit_amount: l.amount,
          spent_amount: spent,
          remaining: spent !== null ? (l.amount - spent).toFixed(2) : null,
          status: spent !== null
            ? spent > l.amount ? 'acima_do_limite' : spent > l.amount * 0.8 ? 'proximo_do_limite' : 'dentro_do_limite'
            : null,
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ spending_limits: result }, null, 2),
        }],
      };
    }
  );
}
