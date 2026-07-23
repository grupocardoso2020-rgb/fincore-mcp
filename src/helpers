// src/helpers/finnotas.ts
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

// ─── Tipos ───────────────────────────────────────────────

export interface FinnotasConfig {
  companyId: string;
  apiKey: string;
}

export interface FinnotasClient {
  id: string;
  name: string;
  document?: string;       // CPF ou CNPJ
  external_id?: string;
}

export interface FinnotasService {
  id: string;
  name: string;
  codigo?: string;         // código LC 116
  aliquota_iss?: number;
}

export interface FinnotasProduct {
  id: string;
  name: string;
  ncm?: string;
  price?: number;
}

export interface MatchResult<T> {
  exact_match: T | null;
  suggestions: T[];
  all: T[];
}

// ─── Config & Auth ───────────────────────────────────────

const FINNOTAS_API_BASE_URL = process.env.FINNOTAS_API_BASE_URL;
const FINNOTAS_ENCRYPTION_KEY = process.env.FINNOTAS_ENCRYPTION_KEY;

/**
 * Valida acesso à entidade + retorna config FinNotas (companyId + apiKey).
 * Lança erro descritivo se integração não estiver ativa.
 */
export async function getFinnotasConfig(
  auth: AuthContext,
  entityId: string
): Promise<FinnotasConfig> {
  // 1. Validar acesso à entidade (padrão MCP existente)
  await validateEntityAccess(auth, entityId);

  // 2. Ler config FinNotas da entidade
  const { data: entity, error } = await supabase
    .from('entities')
    .select('finnotas_enabled, finnotas_company_id, finnotas_api_key_encrypted')
    .eq('id', entityId)
    .single();

  if (error || !entity) {
    throw new Error('Entidade não encontrada');
  }

  if (!entity.finnotas_enabled) {
    throw new Error(
      'A integração FinNotas não está ativa nesta entidade. ' +
      'Configure em Configurações → Integrações.'
    );
  }

  if (!entity.finnotas_company_id) {
    throw new Error(
      'Entidade sem empresa vinculada ao FinNotas. ' +
      'Configure o vínculo em Configurações → Integrações.'
    );
  }

  if (!entity.finnotas_api_key_encrypted) {
    throw new Error(
      'Chave de API do FinNotas não configurada para esta entidade.'
    );
  }

  // 3. Descriptografar API key via RPC
  const { data: decrypted, error: decryptError } = await supabase
    .rpc('finnotas_decrypt_for_entity', {
      p_entity_id: entityId,
      p_psw: FINNOTAS_ENCRYPTION_KEY,
    });

  if (decryptError || !decrypted) {
    throw new Error('Falha ao descriptografar chave do FinNotas: ' + (decryptError?.message ?? 'chave vazia'));
  }

  return {
    companyId: entity.finnotas_company_id,
    apiKey: decrypted,
  };
}

// ─── HTTP helper ─────────────────────────────────────────

/**
 * Chamada genérica ao FinNotas. Trata erros HTTP e parse de JSON.
 */
export async function finnotasRequest<T = any>(
  apiKey: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, any>
): Promise<T> {
  if (!FINNOTAS_API_BASE_URL) {
    throw new Error('FINNOTAS_API_BASE_URL não configurada no servidor MCP');
  }

  const url = `${FINNOTAS_API_BASE_URL}${path}`;

  console.log(`[finnotas] ${method} ${path}`);

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });

  const responseBody = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = responseBody?.error
      ?? responseBody?.message
      ?? `HTTP ${res.status}`;
    console.error(`[finnotas] Erro: ${errorMsg}`, responseBody);
    throw new Error(`FinNotas: ${errorMsg}`);
  }

  return responseBody as T;
}

// ─── Busca com match ─────────────────────────────────────

/**
 * Normaliza string para comparação (lowercase, sem acentos).
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Busca clientes no FinNotas com fuzzy match por nome.
 */
export async function searchFinnotasClients(
  apiKey: string,
  companyId: string,
  searchTerm: string
): Promise<MatchResult<FinnotasClient>> {
  const data = await finnotasRequest<any>(
    apiKey,
    'GET',
    `/v1-clients?company_id=${companyId}`
  );

  const clients: FinnotasClient[] = (data?.clients ?? data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name ?? c.nome ?? '',
    document: c.document ?? c.cpf_cnpj ?? c.documento ?? undefined,
    external_id: c.external_id ?? undefined,
  }));

  return fuzzyMatch(clients, searchTerm, (c) => c.name);
}

/**
 * Busca serviços no FinNotas.
 */
export async function searchFinnotasServices(
  apiKey: string,
  companyId: string,
  searchTerm?: string
): Promise<MatchResult<FinnotasService>> {
  const data = await finnotasRequest<any>(
    apiKey,
    'GET',
    `/v1-services?company_id=${companyId}`
  );

  const services: FinnotasService[] = (data?.services ?? data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name ?? s.nome ?? s.descricao ?? '',
    codigo: s.codigo ?? s.code ?? undefined,
    aliquota_iss: s.aliquota_iss ?? s.aliquotaIss ?? undefined,
  }));

  if (!searchTerm) {
    return { exact_match: null, suggestions: [], all: services };
  }

  return fuzzyMatch(services, searchTerm, (s) => s.name);
}

/**
 * Busca produtos no FinNotas.
 */
export async function searchFinnotasProducts(
  apiKey: string,
  companyId: string,
  searchTerm?: string
): Promise<MatchResult<FinnotasProduct>> {
  const data = await finnotasRequest<any>(
    apiKey,
    'GET',
    `/v1-products?company_id=${companyId}`
  );

  const products: FinnotasProduct[] = (data?.products ?? data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name ?? p.nome ?? p.descricao ?? '',
    ncm: p.ncm ?? undefined,
    price: p.price ?? p.preco ?? p.valor_unitario ?? undefined,
  }));

  if (!searchTerm) {
    return { exact_match: null, suggestions: [], all: products };
  }

  return fuzzyMatch(products, searchTerm, (p) => p.name);
}

// ─── Fuzzy match genérico ────────────────────────────────

/**
 * Match genérico: exact → startsWith → includes.
 * Retorna exact_match se houver match único, suggestions se houver múltiplos,
 * e all sempre com a lista completa.
 */
function fuzzyMatch<T>(
  items: T[],
  searchTerm: string,
  getName: (item: T) => string
): MatchResult<T> {
  const term = normalize(searchTerm);

  // 1. Match exato
  const exact = items.filter((i) => normalize(getName(i)) === term);
  if (exact.length === 1) {
    return { exact_match: exact[0], suggestions: [], all: items };
  }

  // 2. Começa com
  const startsWith = items.filter((i) =>
    normalize(getName(i)).startsWith(term)
  );
  if (startsWith.length === 1) {
    return { exact_match: startsWith[0], suggestions: [], all: items };
  }
  if (startsWith.length > 1) {
    return { exact_match: null, suggestions: startsWith, all: items };
  }

  // 3. Contém
  const includes = items.filter((i) =>
    normalize(getName(i)).includes(term)
  );
  if (includes.length === 1) {
    return { exact_match: includes[0], suggestions: [], all: items };
  }
  if (includes.length > 1) {
    return { exact_match: null, suggestions: includes, all: items };
  }

  // 4. Nenhum match
  return { exact_match: null, suggestions: [], all: items };
}
