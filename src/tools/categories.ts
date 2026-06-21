import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerCategoryTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'get_categories',
    'Lista categorias de uma entidade. Retorna keywords e financial_classification para categorização automática de lançamentos.',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      type: z.enum(['income', 'expense']).optional().describe('Filtrar por tipo'),
    },
    async ({ entity_id, type }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      let query = supabase
        .from('categories')
        .select('id, name, type, color, icon, keywords, financial_classification')
        .eq('entity_id', entity_id)
        .order('name');

      if (type) query = query.eq('type', type);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ categories: data ?? [] }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'create_category',
    `Cria uma nova categoria no Fincore.

financial_classification — valores válidos (apenas para despesas):
- cmv: Custo da Mercadoria Vendida (estoque, matéria-prima)
- csp: Custo do Serviço Prestado (mão de obra direta, material direto)
- variable_cost: Custo Variável (varia proporcionalmente às vendas)
- fixed_cost: Custo Fixo (não varia conforme as vendas)
- investment: Investimento (retorno esperado — equipamentos, tecnologia, reformas)
- transfer: Transferência (movimentação de capital, distribuição de lucro, aportes)

Para receitas, omitir financial_classification.
keywords — palavras que identificam lançamentos desta categoria automaticamente (ex: ['aluguel', 'locação'])`,
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
      name: z.string().describe('Nome da categoria — obrigatório'),
      type: z.enum(['income', 'expense']).describe('Tipo: income (receita) ou expense (despesa) — obrigatório'),
      color: z.string().optional().describe('Cor em hex (ex: #6366f1) — default #6366f1'),
      icon: z.string().optional().describe('Ícone — default "tag"'),
      keywords: z.array(z.string()).optional().describe('Palavras-chave para categorização automática (ex: ["aluguel", "locação"])'),
      financial_classification: z.enum([
        'cmv', 'csp', 'variable_cost', 'fixed_cost', 'investment', 'transfer'
      ]).optional().describe('Classificação financeira — apenas para despesas'),
    },
    async ({ entity_id, name, type, color, icon, keywords, financial_classification }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('categories')
        .insert({
          entity_id,
          name,
          type,
          color: color ?? '#6366f1',
          icon: icon ?? 'tag',
          keywords: keywords ?? [],
          financial_classification: financial_classification ?? null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Categoria "${name}" criada com sucesso.`,
            category: data,
          }, null, 2),
        }],
      };
    }
  );
}
