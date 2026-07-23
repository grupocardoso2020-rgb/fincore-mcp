// src/tools/invoices.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AuthContext } from '../auth.js';
import {
  getFinnotasConfig,
  finnotasRequest,
  searchFinnotasClients,
  searchFinnotasServices,
  searchFinnotasProducts,
  MatchResult,
} from '../helpers/finnotas.js';

// ─── Helper: formata resultado de match pra resposta legível ────

function formatMatchResult<T extends { id: string; name: string }>(
  result: MatchResult<T>,
  entityType: string,
  searchTerm: string
): { resolved: T | null; message: string } {
  if (result.exact_match) {
    return { resolved: result.exact_match, message: '' };
  }

  if (result.suggestions.length > 0) {
    const list = result.suggestions
      .map((s: { id: string; name: string }, i: number) => `  ${i + 1}. ${s.name} (id: ${s.id})`)
      .join('\n');
    return {
      resolved: null,
      message:
        `Encontrei ${result.suggestions.length} ${entityType}(s) parecido(s) com "${searchTerm}":\n${list}\n\n` +
        `Use o campo ${entityType === 'cliente' ? 'client_id' : entityType === 'serviço' ? 'service_id' : 'product_id'} com o ID exato para especificar.`,
    };
  }

  if (result.all.length > 0) {
    const list = result.all
      .map((s: { id: string; name: string }, i: number) => `  ${i + 1}. ${s.name} (id: ${s.id})`)
      .join('\n');
    return {
      resolved: null,
      message:
        `Nenhum ${entityType} encontrado com "${searchTerm}".\n\n` +
        `${entityType}s cadastrados:\n${list}`,
    };
  }

  return {
    resolved: null,
    message: `Nenhum ${entityType} cadastrado nesta empresa do FinNotas.`,
  };
}

// ─── Registro das 7 tools ───────────────────────────────────────

export function registerInvoiceTools(server: McpServer, getAuth: () => AuthContext) {

  // ── Tool 1: list_services ──────────────────────────────────

  server.tool(
    'list_services',
    'Lista serviços cadastrados no FinNotas para emissão de NFS-e. Retorna nome, código LC 116 e alíquota ISS de cada serviço.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      search_term: z.string().optional().describe('Filtrar por nome do serviço (opcional)'),
    },
    async ({ entity_id, search_term }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      const result = await searchFinnotasServices(config.apiKey, config.companyId, search_term);

      const list = search_term && result.exact_match
        ? [result.exact_match]
        : search_term && result.suggestions.length > 0
          ? result.suggestions
          : result.all;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ services: list, total: list.length }, null, 2),
        }],
      };
    }
  );

  // ── Tool 2: list_products ──────────────────────────────────

  server.tool(
    'list_products',
    'Lista produtos cadastrados no FinNotas para emissão de NF-e. Retorna nome, NCM e preço unitário de cada produto.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      search_term: z.string().optional().describe('Filtrar por nome do produto (opcional)'),
    },
    async ({ entity_id, search_term }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      const result = await searchFinnotasProducts(config.apiKey, config.companyId, search_term);

      const list = search_term && result.exact_match
        ? [result.exact_match]
        : search_term && result.suggestions.length > 0
          ? result.suggestions
          : result.all;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ products: list, total: list.length }, null, 2),
        }],
      };
    }
  );

  // ── Tool 3: list_invoices ──────────────────────────────────

  server.tool(
    'list_invoices',
    'Lista notas fiscais emitidas no FinNotas. Filtre por tipo (nfse/nfe) e status.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      tipo: z.enum(['nfse', 'nfe']).optional().describe('Filtrar por tipo: nfse (serviço) ou nfe (mercadoria)'),
      status: z.string().optional().describe('Filtrar por status: issued, pending, rejected, cancelled'),
      limit: z.number().optional().describe('Quantidade máxima de resultados (padrão: 20)'),
    },
    async ({ entity_id, tipo, status, limit }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      const queryParams = new URLSearchParams({ company_id: config.companyId });
      if (tipo) queryParams.set('tipo', tipo);
      if (status) queryParams.set('status', status);
      if (limit) queryParams.set('limit', String(limit));

      const data = await finnotasRequest(
        config.apiKey,
        'GET',
        `/v1-invoices?${queryParams.toString()}`
      );

      const invoices = data?.invoices ?? data?.data ?? data ?? [];

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ invoices, total: Array.isArray(invoices) ? invoices.length : 0 }, null, 2),
        }],
      };
    }
  );

  // ── Tool 4: get_invoice_status ─────────────────────────────

  server.tool(
    'get_invoice_status',
    'Consulta o status detalhado de uma nota fiscal específica no FinNotas, incluindo chave de acesso e URLs de PDF/XML.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      invoice_id: z.string().uuid().describe('ID da nota fiscal no FinNotas'),
    },
    async ({ entity_id, invoice_id }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      const data = await finnotasRequest(
        config.apiKey,
        'GET',
        `/v1-invoices?company_id=${config.companyId}&id=${invoice_id}`
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ invoice: data }, null, 2),
        }],
      };
    }
  );

  // ── Tool 5: emit_nfse ──────────────────────────────────────

  server.tool(
    'emit_nfse',
    'Emite uma Nota Fiscal de Serviço Eletrônica (NFS-e) via FinNotas. Requer cliente e serviço já cadastrados. Use list_services e get_clients para encontrar os IDs antes de emitir.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      client_id: z.string().uuid().optional().describe('ID do cliente no FinNotas (use se já souber)'),
      client_name: z.string().optional().describe('Nome do cliente para busca (se não tiver o ID)'),
      service_id: z.string().uuid().optional().describe('ID do serviço no FinNotas (use se já souber)'),
      service_name: z.string().optional().describe('Nome do serviço para busca (se não tiver o ID)'),
      value: z.number().positive().describe('Valor total do serviço em reais (ex: 500.00)'),
      description: z.string().describe('Descrição do serviço prestado'),
      iss_retido: z.boolean().optional().describe('ISS retido pelo tomador? (padrão: false)'),
    },
    async ({ entity_id, client_id, client_name, service_id, service_name, value, description, iss_retido }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      // ── Resolver cliente ──
      let resolvedClientId = client_id;
      if (!resolvedClientId) {
        if (!client_name) {
          throw new Error('Informe client_id ou client_name para identificar o cliente.');
        }
        const clientResult = await searchFinnotasClients(config.apiKey, config.companyId, client_name);
        const { resolved, message } = formatMatchResult(clientResult, 'cliente', client_name);
        if (!resolved) {
          return { content: [{ type: 'text', text: message }] };
        }
        resolvedClientId = resolved.id;
      }

      // ── Resolver serviço ──
      let resolvedService: { id: string; codigo?: string; aliquota_iss?: number } | null = null;
      if (service_id) {
        resolvedService = { id: service_id };
      } else if (service_name) {
        const serviceResult = await searchFinnotasServices(config.apiKey, config.companyId, service_name);
        const { resolved, message } = formatMatchResult(serviceResult, 'serviço', service_name);
        if (!resolved) {
          return { content: [{ type: 'text', text: message }] };
        }
        resolvedService = resolved;
      } else {
        throw new Error('Informe service_id ou service_name para identificar o serviço.');
      }

      // ── Montar payload NFS-e ──
      const payload: Record<string, any> = {
        company_id: config.companyId,
        tipo: 'nfse',
        client_id: resolvedClientId,
        servico: {
          descricao: description,
          ...(resolvedService.codigo && { codigo: resolvedService.codigo }),
          ...(resolvedService.aliquota_iss && { aliquotaIss: resolvedService.aliquota_iss }),
        },
        valores: {
          total: value,
          issRetido: iss_retido ?? false,
        },
      };

      // ── Emitir ──
      const result = await finnotasRequest(config.apiKey, 'POST', '/v1-invoices', payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'NFS-e emitida com sucesso!',
            invoice: result,
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool 6: emit_nfe ───────────────────────────────────────

  server.tool(
    'emit_nfe',
    'Emite uma Nota Fiscal Eletrônica de mercadoria (NF-e) via FinNotas. Requer cliente e produtos já cadastrados. Use list_products e get_clients para encontrar os IDs antes de emitir.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      client_id: z.string().uuid().optional().describe('ID do cliente no FinNotas'),
      client_name: z.string().optional().describe('Nome do cliente para busca'),
      items: z.array(z.object({
        product_id: z.string().uuid().optional().describe('ID do produto no FinNotas'),
        product_name: z.string().optional().describe('Nome do produto para busca'),
        quantity: z.number().positive().describe('Quantidade'),
        unit_price: z.number().positive().describe('Preço unitário em reais'),
      })).min(1).describe('Lista de itens da nota fiscal'),
      payment_method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto'])
        .describe('Forma de pagamento'),
      natureza_operacao: z.string().optional().describe('Natureza da operação (padrão: "Venda de mercadoria")'),
    },
    async ({ entity_id, client_id, client_name, items, payment_method, natureza_operacao }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      // ── Resolver cliente ──
      let resolvedClientId = client_id;
      if (!resolvedClientId) {
        if (!client_name) {
          throw new Error('Informe client_id ou client_name para identificar o cliente.');
        }
        const clientResult = await searchFinnotasClients(config.apiKey, config.companyId, client_name);
        const { resolved, message } = formatMatchResult(clientResult, 'cliente', client_name);
        if (!resolved) {
          return { content: [{ type: 'text', text: message }] };
        }
        resolvedClientId = resolved.id;
      }

      // ── Resolver produtos dos items ──
      const resolvedItems: Array<{
        product_id: string;
        quantidade: number;
        valorUnitario: number;
        valorTotal: number;
        descricao: string;
        ncm: string;
        cfop: string;
        cst: string;
        unidade: string;
      }> = [];

      for (const item of items) {
        let productId = item.product_id;
        let productName = item.product_name ?? 'Produto';
        let productNcm: string | undefined = undefined;
        if (!productId) {
          if (!item.product_name) {
            throw new Error('Cada item precisa de product_id ou product_name.');
          }
          const productResult = await searchFinnotasProducts(config.apiKey, config.companyId, item.product_name);
          const { resolved, message } = formatMatchResult(productResult, 'produto', item.product_name);
          if (!resolved) {
            return { content: [{ type: 'text', text: message }] };
          }
          productId = resolved.id;
          productName = resolved.name;
          productNcm = resolved.ncm;
        }
        resolvedItems.push({
          product_id: productId,
          quantidade: item.quantity,
          valorUnitario: item.unit_price,
          valorTotal: item.quantity * item.unit_price,
          descricao: productName,
          ncm: productNcm ?? '00000000',
          cfop: '5102',
          cst: '102',
          unidade: 'UN',
        });
      }

      // ── Mapear forma de pagamento ──
      const paymentTypeMap: Record<string, string> = {
        dinheiro: '01',
        cartao_credito: '03',
        cartao_debito: '04',
        pix: '17',
        boleto: '15',
      };

      const totalValue = resolvedItems.reduce((sum, i) => sum + i.valorTotal, 0);

      // ── Montar payload NF-e ──
      const payload: Record<string, any> = {
        company_id: config.companyId,
        tipo: 'nfe',
        client_id: resolvedClientId,
        natureza_operacao: natureza_operacao ?? 'Venda de mercadoria',
        items: resolvedItems,
        pagamentos: [{
          tipoPagamento: paymentTypeMap[payment_method] ?? '99',
          valor: totalValue,
        }],
      };

      // ── Emitir ──
      const result = await finnotasRequest(config.apiKey, 'POST', '/v1-invoices', payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'NF-e emitida com sucesso!',
            invoice: result,
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool 7: cancel_invoice ─────────────────────────────────

  server.tool(
    'cancel_invoice',
    'Cancela uma nota fiscal emitida (NFS-e ou NF-e) no FinNotas. A nota precisa estar com status "issued" para ser cancelada.',
    {
      entity_id: z.string().uuid().describe('ID da entidade no FinCore'),
      invoice_id: z.string().uuid().describe('ID da nota fiscal a cancelar'),
      motivo: z.string().min(15).describe('Motivo do cancelamento (mínimo 15 caracteres, exigido pela SEFAZ)'),
    },
    async ({ entity_id, invoice_id, motivo }) => {
      const auth = getAuth();
      const config = await getFinnotasConfig(auth, entity_id);

      const result = await finnotasRequest(
        config.apiKey,
        'POST',
        '/v1-invoices',
        {
          company_id: config.companyId,
          action: 'cancel',
          invoice_id,
          motivo,
        }
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Nota fiscal cancelada com sucesso.',
            result,
          }, null, 2),
        }],
      };
    }
  );
}
