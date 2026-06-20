import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabase } from '../supabase.js';
import { AuthContext } from '../auth.js';

export function registerEntityTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'list_entities',
    'Lista todas as entidades disponíveis para esta API Key',
    {},
    async () => {
      const auth = getAuth();

      // Entidades próprias
      const { data: owned, error: ownedError } = await supabase
        .from('entities')
        .select('id, name, type, color')
        .eq('owner_id', auth.user_id)
        .order('name');

      if (ownedError) throw new Error(ownedError.message);

      // Entidades membro
      const { data: member, error: memberError } = await supabase
        .from('entity_members')
        .select('entity_id, role, entities(id, name, type, color)')
        .eq('user_id', auth.user_id)
        .neq('entity_id', null);

      if (memberError) throw new Error(memberError.message);

      const ownedList = (owned ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        color: e.color,
        access: 'owner',
      }));

      const memberList = (member ?? [])
        .filter((m) => m.entities)
        .map((m: any) => ({
          id: m.entities.id,
          name: m.entities.name,
          type: m.entities.type,
          color: m.entities.color,
          access: m.role,
        }));

      // Filtra por entity_ids da key se definido
      const all = [...ownedList, ...memberList];
      const filtered = auth.entity_ids
        ? all.filter((e) => auth.entity_ids!.includes(e.id))
        : all;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ entities: filtered }, null, 2),
          },
        ],
      };
    }
  );
}
