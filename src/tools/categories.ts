import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerCategoryTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'get_categories',
    'Lista categorias de uma entidade. Retorna nome, tipo, palavras-chave (keywords) e classificação financeira (financial_classification) para permitir categorização automática de lançamentos.',
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
}
