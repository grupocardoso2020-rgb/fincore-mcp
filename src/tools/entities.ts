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

      console.log('list_entities — user_id:', auth.user_id);
      console.log('list_entities — entity_ids filter:', auth.entity_ids);

      // Entidades próprias
      const { data: owned, error: ownedError } = await supabase
        .from('entities')
        .select('id, name, type, color')
        .eq('owner_id', auth.user_id)
        .order('name');

      if (ownedError) {
        console.log('Erro owned:', ownedError.message);
        throw new Error(ownedError.message);
      }

      console.log('Entidades próprias encontradas:', owned?.length ?? 0);

      // Entidades membro — query separada sem join aninhado
      const { data: memberLinks, error: memberError } = await supabase
        .from('entity_members')
        .select('entity_id, role')
        .eq('user_id', auth.user_id);

      if (memberError) {
        console.log('Erro member links:', memberError.message);
        throw new Error(memberError.message);
      }

      console.log('Member links encontrados:', memberLinks?.length ?? 0);

      // Busca detalhes das entidades membro
      const memberEntityIds = (memberLinks ?? []).map((m) => m.entity_id);
      let memberEntities: any[] = [];

      if (memberEntityIds.length > 0) {
        const { data: entData, error: entError } = await supabase
          .from('entities')
          .select('id, name, type, color, owner_id')
          .in('id', memberEntityIds)
          .neq('owner_id', auth.user_id); // exclui próprias

        if (entError) {
          console.log('Erro member entities:', entError.message);
          throw new Error(entError.message);
        }

        memberEntities = (entData ?? []).map((e) => {
          const link = memberLinks!.find((m) => m.entity_id === e.id);
          return {
            id: e.id,
            name: e.name,
            type: e.type,
            color: e.color,
            access: link?.role ?? 'member',
          };
        });
      }

      const ownedList = (owned ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        color: e.color,
        access: 'owner',
      }));

      // Filtra por entity_ids da key se definido
      const all = [...ownedList, ...memberEntities];
      const filtered = auth.entity_ids
        ? all.filter((e) => auth.entity_ids!.includes(e.id))
        : all;

      console.log('Total entidades retornadas:', filtered.length);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ entities: filtered }, null, 2),
        }],
      };
    }
  );
}
