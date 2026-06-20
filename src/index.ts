import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateApiKey, AuthContext } from './auth.js';
import { registerEntityTools } from './tools/entities.js';
import { registerTransactionTools } from './tools/transactions.js';
import { registerBankAccountTools } from './tools/bank_accounts.js';
import { registerCategoryTools } from './tools/categories.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerReportTools } from './tools/reports.js';
import { registerImportTools } from './tools/import.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fincore-mcp', version: '1.0.0' });
});

// MCP endpoint
app.post('/mcp', async (req, res) => {
  let auth: AuthContext;

  try {
    auth = await validateApiKey(req.headers.authorization);
  } catch (err: any) {
    res.status(401).json({ error: err.message ?? 'Unauthorized' });
    return;
  }

  const server = new McpServer({
    name: 'fincore-mcp',
    version: '1.0.0',
  });

  // Closure para passar auth para cada tool
  const getAuth = () => auth;

  // Registra todas as tools
  registerEntityTools(server, getAuth);
  registerTransactionTools(server, getAuth);
  registerBankAccountTools(server, getAuth);
  registerCategoryTools(server, getAuth);
  registerCalendarTools(server, getAuth);
  registerReportTools(server, getAuth);
  registerImportTools(server, getAuth);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
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

// GET /mcp — necessário para alguns clientes MCP verificarem o endpoint
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
