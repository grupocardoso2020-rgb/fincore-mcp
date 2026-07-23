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
  document?: string;
  external_id?: string;
}

export interface FinnotasService {
  id: string;
  name: string;
  codigo?: string;
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

export async function getFinnotasConfig(
  auth: AuthContext,
  entityId: string
): Promise<FinnotasConfig> {
  await validateEntityAccess(auth, entityId);

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
      'A integração FinNotas não está ativa nesta entidade. Configure em Configurações → Integrações.'
    );
  }

  if (!entity.finnotas_company_id) {
    throw new Error(
      'Entidade sem empresa vinculada ao FinNotas. Configure o vínculo em Configurações → Integrações.'
    );
  }

  if (!entity.finnotas_api_key_encrypted) {
    throw new Error('Chave de API do FinNotas não configurada para esta entidade.');
  }

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

  const responseBody: any = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = typeof responseBody?.error === 'string'
      ? responseBody.error
      : responseBody?.message ?? JSON.stringify(responseBody) ?? `HTTP ${res.status}`;
    console.error(`[finnotas] Erro: ${errorMsg}`, responseBody);
    throw new Error(`FinNotas: ${errorMsg}`);
  }

  return responseBody as T;
}

// ─── Busca com match ─────────────────────────────────────

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

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

  const found = data?.clients ?? data?.items ?? data?.data ?? data;
  const raw = Array.isArray(found) ? found : (found?.items ?? []);
  const clients: FinnotasClient[] = raw.map((c: any) => ({
    id: c.id,
    name: c.name ?? c.nome ?? '',
    document: c.document ?? c.cpf_cnpj ?? c.documento ?? undefined,
    external_id: c.external_id ?? undefined,
  }));

  return fuzzyMatch(clients, searchTerm, (c: FinnotasClient) => c.name);
}

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

  const found = data?.services ?? data?.items ?? data?.data ?? data;
  const raw = Array.isArray(found) ? found : (found?.items ?? []);
  const services: FinnotasService[] = raw.map((s: any) => ({
    id: s.id,
    name: s.name ?? s.nome ?? s.descricao ?? '',
    codigo: s.codigo ?? s.code ?? undefined,
    aliquota_iss: s.aliquota_iss ?? s.aliquotaIss ?? undefined,
  }));

  if (!searchTerm) {
    return { exact_match: null, suggestions: [], all: services };
  }

  return fuzzyMatch(services, searchTerm, (s: FinnotasService) => s.name);
}

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

  const found = data?.products ?? data?.items ?? data?.data ?? data;
  const raw = Array.isArray(found) ? found : (found?.items ?? []);
  const products: FinnotasProduct[] = raw.map((p: any) => ({
    id: p.id,
    name: p.name ?? p.nome ?? p.descricao ?? '',
    ncm: p.ncm ?? undefined,
    price: p.price ?? p.preco ?? p.valor_unitario ?? undefined,
  }));

  if (!searchTerm) {
    return { exact_match: null, suggestions: [], all: products };
  }

  return fuzzyMatch(products, searchTerm, (p: FinnotasProduct) => p.name);
}

// ─── Fuzzy match genérico ────────────────────────────────

function fuzzyMatch<T>(
  items: T[],
  searchTerm: string,
  getName: (item: T) => string
): MatchResult<T> {
  const term = normalize(searchTerm);

  const exact = items.filter((i) => normalize(getName(i)) === term);
  if (exact.length === 1) {
    return { exact_match: exact[0], suggestions: [], all: items };
  }

  const startsWith = items.filter((i) => normalize(getName(i)).startsWith(term));
  if (startsWith.length === 1) {
    return { exact_match: startsWith[0], suggestions: [], all: items };
  }
  if (startsWith.length > 1) {
    return { exact_match: null, suggestions: startsWith, all: items };
  }

  const includes = items.filter((i) => normalize(getName(i)).includes(term));
  if (includes.length === 1) {
    return { exact_match: includes[0], suggestions: [], all: items };
  }
  if (includes.length > 1) {
    return { exact_match: null, suggestions: includes, all: items };
  }

  return { exact_match: null, suggestions: [], all: items };
}
