import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateApiKey, AuthContext } from './auth.js';
import { oauthRouter } from './oauth.js';
import { registerEntityTools } from './tools/entities.js';
import { registerTransactionTools } from './tools/transactions.js';
import { registerBankAccountTools } from './tools/bank_accounts.js';
import { registerCategoryTools } from './tools/categories.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerReportTools } from './tools/reports.js';
import { registerImportTools } from './tools/import.js';
import { supabase } from './supabase.js';
import { registerDeleteTools } from './tools/delete.js';
import { registerRecurringTools } from './tools/recurring.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fincore-mcp', version: '1.0.0' });
});

// OAuth routes
app.use(oauthRouter);

// MCP endpoint
app.post('/mcp', async (req, res) => {
  let auth: AuthContext;

  const authHeader = req.headers.authorization;

  console.log('=== MCP REQUEST ===');
  console.log('Auth header presente:', !!authHeader);
  console.log('Auth header valor:', authHeader ? authHeader.substring(0, 40) + '...' : 'AUSENTE');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('ERRO: Authorization header ausente ou inválido');
    res.status(401).json({ error: 'Authorization header ausente' });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  console.log('Token length:', token.length);
  console.log('Token primeiros 30 chars:', token.substring(0, 30));
  console.log('Começa com fincore_:', token.startsWith('fincore_'));

  try {
    if (token.startsWith('fincore_')) {
      console.log('Autenticando via API Key direta');
      auth = await validateApiKey(authHeader);
    } else {
      console.log('Autenticando via hash OAuth');
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('id, user_id, entity_ids, revoked_at')
        .eq('key_hash', token)
        .is('revoked_at', null)
        .single();

      console.log('Resultado busca hash:', { found: !!data, error: error?.message });

      if (error || !data) {
        console.log('ERRO: Token inválido ou revogado');
        res.status(401).json({ error: 'Token inválido ou revogado' });
        return;
      }

      supabase
        .from('user_api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(() => {});

      auth = {
        user_id: data.user_id,
        entity_ids: data.entity_ids ?? null,
      };
      console.log('Auth OK — user_id:', data.user_id);
    }
  } catch (err: any) {
    console.log('ERRO autenticação:', err.message);
    res.status(401).json({ error: err.message ?? 'Unauthorized' });
    return;
  }

  const server = new McpServer({
    name: 'fincore-mcp',
    version: '1.0.0',
  });

  const getAuth = () => auth;

  registerEntityTools(server, getAuth);
  registerTransactionTools(server, getAuth);
  registerBankAccountTools(server, getAuth);
  registerCategoryTools(server, getAuth);
  registerCalendarTools(server, getAuth);
  registerReportTools(server, getAuth);
  registerImportTools(server, getAuth);
  registerDeleteTools(server, getAuth);
  registerRecurringTools(server, getAuth);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    console.log('Conectando MCP server...');
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    console.log('MCP request processado com sucesso');
  } catch (err: any) {
    console.log('ERRO MCP:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message ?? 'Internal server error' });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.json({
    name: 'fincore-mcp',
    version: '1.0.0',
    description: 'MCP Server para integração do Claude com o Fincore',
  });
});

app.listen(PORT, () => {
  console.log(`Fincore MCP Server rodando na porta ${PORT}`);
});
