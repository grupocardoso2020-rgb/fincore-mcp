import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHash } from 'crypto';
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

// MCP endpoint — aceita Bearer token (API Key hash do OAuth ou API Key direta)
app.post('/mcp', async (req, res) => {
  let auth: AuthContext;

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header ausente' });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    // Tenta autenticar via API Key direta (fincore_...)
    if (token.startsWith('fincore_')) {
      auth = await validateApiKey(authHeader);
    } else {
      // Token é um hash de API Key (vindo do OAuth)
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('id, user_id, entity_ids, revoked_at')
        .eq('key_hash', token)
        .is('revoked_at', null)
        .single();

      if (error || !data) {
        res.status(401).json({ error: 'Token inválido ou revogado' });
        return;
      }

      // Atualiza last_used_at em background
      supabase
        .from('user_api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(() => {});

      auth = {
        user_id: data.user_id,
        entity_ids: data.entity_ids ?? null,
      };
    }
  } catch (err: any) {
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
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
