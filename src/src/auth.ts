import { createHash } from 'crypto';
import { supabase } from './supabase.js';

export interface AuthContext {
  user_id: string;
  entity_ids: string[] | null; // null = todas as entidades do usuário
}

export async function validateApiKey(authHeader: string | undefined): Promise<AuthContext> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header ausente ou inválido');
  }

  const token = authHeader.replace('Bearer ', '').trim();

  if (!token.startsWith('fincore_')) {
    throw new Error('API Key inválida');
  }

  // Hash SHA-256 do token
  const keyHash = createHash('sha256').update(token).digest('hex');

  // Busca a key no banco
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('id, user_id, entity_ids, revoked_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    throw new Error('API Key inválida ou revogada');
  }

  // Atualiza last_used_at em background (não bloqueia a resposta)
  supabase
    .from('user_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    user_id: data.user_id,
    entity_ids: data.entity_ids ?? null,
  };
}

// Valida se o user tem acesso a uma entidade específica
export async function validateEntityAccess(
  auth: AuthContext,
  entity_id: string
): Promise<void> {
  // Se a key tem entity_ids específicos, verifica se esse está na lista
  if (auth.entity_ids !== null && !auth.entity_ids.includes(entity_id)) {
    throw new Error(`Acesso negado à entidade ${entity_id}`);
  }

  // Verifica se o user é owner ou membro da entidade
  const { data: owned } = await supabase
    .from('entities')
    .select('id')
    .eq('id', entity_id)
    .eq('owner_id', auth.user_id)
    .single();

  if (owned) return; // É owner — acesso total

  // Verifica se é membro
  const { data: member } = await supabase
    .from('entity_members')
    .select('id, role')
    .eq('entity_id', entity_id)
    .eq('user_id', auth.user_id)
    .single();

  if (!member) {
    throw new Error(`Acesso negado à entidade ${entity_id}`);
  }
}
