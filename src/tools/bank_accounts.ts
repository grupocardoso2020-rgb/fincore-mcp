import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

export function registerBankAccountTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'get_bank_accounts',
    'Lista contas bancárias e cartões de uma entidade',
    {
      entity_id: z.string().uuid().describe('ID da entidade'),
    },
    async ({ entity_id }) => {
      const auth = getAuth();
      await validateEntityAccess(auth, entity_id);

      const { data, error } = await supabase
        .from('bank_accounts')
        .select('id, name, bank_name, account_type, type, current_balance, is_default, is_active')
        .eq('entity_id', entity_id)
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ bank_accounts: data ?? [] }, null, 2),
        }],
      };
    }
  );
}
