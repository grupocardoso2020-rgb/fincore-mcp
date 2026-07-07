import { Router } from 'express';

export const openapiRouter = Router();

openapiRouter.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'Fincore API',
      description: 'API REST do Fincore para integração via GPT Actions. Autenticação: Bearer token (API Key gerada em Configurações → Integrações → AI).',
      version: '1.0.0',
    },
    servers: [{ url: 'https://mcp.fincore.app.br' }],
    security: [{ BearerAuth: [] }],
    components: {
  schemas: {},
  securitySchemes: {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      description: 'API Key gerada no Fincore em Configurações → Integrações → AI',
    },
  },
},
    paths: {
      '/actions/list_entities': {
        get: {
          operationId: 'list_entities',
          summary: 'Lista todas as entidades disponíveis para esta API Key',
          responses: { '200': { description: 'Lista de entidades' } },
        },
      },
      '/actions/get_transactions': {
        get: {
          operationId: 'get_transactions',
          summary: 'Busca lançamentos financeiros por período',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'date_from', in: 'query', required: true, schema: { type: 'string' }, description: 'Data inicial YYYY-MM-DD' },
            { name: 'date_to', in: 'query', required: true, schema: { type: 'string' }, description: 'Data final YYYY-MM-DD' },
            { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['income', 'expense'] } },
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['paid', 'pending', 'cancelled'] } },
          ],
          responses: { '200': { description: 'Lista de lançamentos com resumo' } },
        },
      },
      '/actions/get_categories': {
        get: {
          operationId: 'get_categories',
          summary: 'Lista categorias de uma entidade',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['income', 'expense'] } },
          ],
          responses: { '200': { description: 'Lista de categorias' } },
        },
      },
      '/actions/get_bank_accounts': {
        get: {
          operationId: 'get_bank_accounts',
          summary: 'Lista contas bancárias e cartões de uma entidade',
          parameters: [{ name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Lista de contas' } },
        },
      },
      '/actions/get_payment_methods': {
        get: {
          operationId: 'get_payment_methods',
          summary: 'Lista formas de pagamento de uma entidade',
          parameters: [{ name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Lista de formas de pagamento' } },
        },
      },
      '/actions/get_suppliers': {
        get: {
          operationId: 'get_suppliers',
          summary: 'Lista fornecedores de uma entidade',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'search', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Lista de fornecedores' } },
        },
      },
      '/actions/get_clients': {
        get: {
          operationId: 'get_clients',
          summary: 'Lista clientes de uma entidade',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'search', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Lista de clientes' } },
        },
      },
      '/actions/create_category': {
  post: {
    operationId: 'create_category',
    summary: 'Cria uma nova categoria. financial_classification: cmv, csp, variable_cost, fixed_cost, investment, transfer (apenas despesas).',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['entity_id', 'name', 'type'],
            properties: {
              entity_id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string', enum: ['income', 'expense'] },
              color: { type: 'string', description: 'Hex ex: #6366f1' },
              icon: { type: 'string', description: 'Nome do ícone' },
              keywords: { type: 'array', items: { type: 'string' }, description: 'Palavras-chave para categorização automática' },
              financial_classification: { type: 'string', enum: ['cmv', 'csp', 'variable_cost', 'fixed_cost', 'investment', 'transfer'], description: 'Apenas para despesas' },
            },
          },
        },
      },
    },
    responses: { '200': { description: 'Categoria criada' } },
  },
},
'/actions/create_supplier': {
  post: {
    operationId: 'create_supplier',
    summary: 'Cria um novo fornecedor',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['entity_id', 'name'],
            properties: {
              entity_id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' },
              document: { type: 'string', description: 'CPF ou CNPJ' },
              notes: { type: 'string' },
            },
          },
        },
      },
    },
    responses: { '200': { description: 'Fornecedor criado' } },
  },
},
'/actions/create_client': {
  post: {
    operationId: 'create_client',
    summary: 'Cria um novo cliente',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['entity_id', 'name'],
            properties: {
              entity_id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' },
              document: { type: 'string', description: 'CPF ou CNPJ' },
              notes: { type: 'string' },
            },
          },
        },
      },
    },
    responses: { '200': { description: 'Cliente criado' } },
  },
},
      '/actions/attach_document': {
  post: {
    operationId: 'attach_document',
    summary: 'Anexa um documento (recibo, nota fiscal, comprovante) a um lançamento existente. Envie o arquivo em base64.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['entity_id', 'transaction_id', 'file_content', 'file_name', 'file_mime_type'],
            properties: {
              entity_id: { type: 'string', description: 'ID da entidade dona do lançamento' },
              transaction_id: { type: 'string', description: 'ID do lançamento ao qual o documento será anexado' },
              file_content: { type: 'string', description: 'Conteúdo do arquivo codificado em base64' },
              file_name: { type: 'string', description: 'Nome original do arquivo (ex: recibo.pdf)' },
              file_mime_type: { type: 'string', enum: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'], description: 'Tipo MIME do arquivo' },
            },
          },
        },
      },
    },
    responses: { '200': { description: 'Documento anexado com sucesso' } },
  },
},
      '/actions/get_summary': {
        get: {
          operationId: 'get_summary',
          summary: 'Resumo financeiro mensal',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'year', in: 'query', required: true, schema: { type: 'integer' } },
            { name: 'month', in: 'query', required: true, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Resumo do mês' } },
        },
      },
      '/actions/get_financial_indicators': {
        get: {
          operationId: 'get_financial_indicators',
          summary: 'Indicadores financeiros: CMV, CSP, margens, lucro',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'year', in: 'query', required: true, schema: { type: 'integer' } },
            { name: 'month', in: 'query', required: true, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Indicadores financeiros' } },
        },
      },
      '/actions/get_goals': {
        get: {
          operationId: 'get_goals',
          summary: 'Lista metas financeiras',
          parameters: [{ name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Lista de metas' } },
        },
      },
      '/actions/get_spending_limits': {
        get: {
          operationId: 'get_spending_limits',
          summary: 'Limites de gastos por categoria',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'year', in: 'query', required: false, schema: { type: 'integer' } },
            { name: 'month', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Limites por categoria' } },
        },
      },
      '/actions/get_calendar_events': {
        get: {
          operationId: 'get_calendar_events',
          summary: 'Lista agendamentos por período',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'date_from', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'date_to', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Lista de agendamentos' } },
        },
      },
      '/actions/create_transaction': {
        post: {
          operationId: 'create_transaction',
          summary: 'Cria um lançamento financeiro. Busque get_categories e get_bank_accounts antes.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'description', 'amount', 'type', 'date', 'status', 'category_id', 'bank_account_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    description: { type: 'string' },
                    amount: { type: 'number' },
                    type: { type: 'string', enum: ['income', 'expense'] },
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                    status: { type: 'string', enum: ['paid', 'pending'] },
                    category_id: { type: 'string' },
                    bank_account_id: { type: 'string' },
                    payment_method_id: { type: 'string', description: 'Obrigatório para receitas' },
                    supplier_id: { type: 'string' },
                    client_id: { type: 'string' },
                    due_date: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Lançamento criado' } },
        },
      },
      '/actions/create_recurring_transaction': {
        post: {
          operationId: 'create_recurring_transaction',
          summary: 'Cria lançamento recorrente. start_date deve incluir o dia exato (YYYY-MM-DD).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'description', 'amount', 'type', 'start_date', 'frequency', 'category_id', 'bank_account_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    description: { type: 'string' },
                    amount: { type: 'number' },
                    type: { type: 'string', enum: ['income', 'expense'] },
                    start_date: { type: 'string', description: 'YYYY-MM-DD com o dia exato' },
                    frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
                    duration_type: { type: 'string', enum: ['indeterminate', 'fixed'], default: 'indeterminate' },
                    recurrence_count: { type: 'integer', description: 'Obrigatório quando duration_type=fixed' },
                    category_id: { type: 'string' },
                    bank_account_id: { type: 'string' },
                    payment_method_id: { type: 'string' },
                    supplier_id: { type: 'string' },
                    client_id: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Recorrência criada' } },
        },
      },
      '/actions/update_transaction': {
        post: {
          operationId: 'update_transaction',
          summary: 'Edita lançamento. Para recorrentes use scope: only | future | all',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'transaction_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    transaction_id: { type: 'string' },
                    scope: { type: 'string', enum: ['only', 'future', 'all'], default: 'only' },
                    description: { type: 'string' },
                    amount: { type: 'number' },
                    date: { type: 'string' },
                    due_date: { type: 'string' },
                    status: { type: 'string', enum: ['paid', 'pending', 'cancelled'] },
                    paid_date: { type: 'string' },
                    category_id: { type: 'string' },
                    bank_account_id: { type: 'string' },
                    payment_method_id: { type: 'string' },
                    supplier_id: { type: 'string' },
                    client_id: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Lançamento atualizado' } },
        },
      },
      '/actions/update_transaction_status': {
        post: {
          operationId: 'update_transaction_status',
          summary: 'Atualiza status de um lançamento',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'transaction_id', 'status'],
                  properties: {
                    entity_id: { type: 'string' },
                    transaction_id: { type: 'string' },
                    status: { type: 'string', enum: ['paid', 'pending', 'cancelled'] },
                    paid_date: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Status atualizado' } },
        },
      },
      '/actions/delete_transaction': {
  post: {
          operationId: 'delete_transaction',
          summary: 'Apaga um lançamento. Confirme com o usuário antes.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'transaction_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    transaction_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Lançamento apagado' } },
        },
      },
      '/actions/import_statement': {
        post: {
          operationId: 'import_statement',
          summary: 'Importa extrato bancário em lote (máx 200 itens)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'bank_account_id', 'transactions'],
                  properties: {
                    entity_id: { type: 'string' },
                    bank_account_id: { type: 'string' },
                    transactions: {
                      type: 'array',
                      maxItems: 200,
                      items: {
                        type: 'object',
                        required: ['description', 'amount', 'type', 'date'],
                        properties: {
                          description: { type: 'string' },
                          amount: { type: 'number' },
                          type: { type: 'string', enum: ['income', 'expense'] },
                          date: { type: 'string' },
                          status: { type: 'string', enum: ['paid', 'pending'], default: 'paid' },
                          category_id: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Extrato importado' } },
        },
      },
      '/actions/create_calendar_event': {
        post: {
          operationId: 'create_calendar_event',
          summary: 'Cria agendamento no calendário',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'title', 'date'],
                  properties: {
                    entity_id: { type: 'string' },
                    title: { type: 'string' },
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                    time: { type: 'string', description: 'HH:MM — omitir para dia inteiro' },
                    description: { type: 'string' },
                    color: { type: 'string', description: 'Hex ex: #3b82f6' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Agendamento criado' } },
        },
      },
      '/actions/create_calendar_reminder': {
        post: {
          operationId: 'create_calendar_reminder',
          summary: 'Cria lembrete para um agendamento',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'event_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    event_id: { type: 'string' },
                    minutes_before: { type: 'integer', default: 30 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Lembrete criado' } },
        },
      },
      '/actions/update_calendar_event': {
        post: {
          operationId: 'update_calendar_event',
          summary: 'Edita um agendamento',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'event_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    event_id: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    date: { type: 'string' },
                    time: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'done', 'missed', 'cancelled'] },
                    color: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Agendamento atualizado' } },
        },
      },
      '/actions/update_calendar_event_status': {
        post: {
          operationId: 'update_calendar_event_status',
          summary: 'Atualiza status de um agendamento',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'event_id', 'status'],
                  properties: {
                    entity_id: { type: 'string' },
                    event_id: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'done', 'missed', 'cancelled'] },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Status atualizado' } },
        },
      },
      '/actions/delete_calendar_event': {
  post: {
          operationId: 'delete_calendar_event',
          summary: 'Apaga agendamento e seus lembretes. Confirme com o usuário antes.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'event_id'],
                  properties: {
                    entity_id: { type: 'string' },
                    event_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Agendamento apagado' } },
        },
      },
      '/actions/create_cash_closing': {
        post: {
          operationId: 'create_cash_closing',
          summary: 'Cria uma Apuração Financeira (fechamento de caixa/turno). Status inicial sempre draft — conversão para lançamentos é manual, feita pelo usuário na tela.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'date', 'total_sales'],
                  properties: {
                    entity_id: { type: 'string' },
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                    shift_label: { type: 'string', description: 'Turno, ex: Manhã, Noite, Caixa 1' },
                    responsible: { type: 'string', description: 'Nome do responsável pelo turno' },
                    total_sales: { type: 'number', description: 'Total de vendas do turno — deve ser maior que zero' },
                    payments: {
                      type: 'array',
                      description: 'Formas de pagamento não-dinheiro (cartão, pix, etc). Use get_payment_methods para os IDs.',
                      items: {
                        type: 'object',
                        properties: {
                          payment_method_id: { type: 'string' },
                          amount: { type: 'number' },
                        },
                      },
                    },
                    movements: {
                      type: 'array',
                      description: "Entradas ('in') e saídas ('out') de caixa durante o turno",
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['in', 'out'] },
                          amount: { type: 'number' },
                          description: { type: 'string' },
                        },
                      },
                    },
                    counted_cash: { type: 'number', description: 'Dinheiro contado fisicamente ao fechar o caixa' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Apuração financeira criada como rascunho' } },
        },
      },
      '/actions/get_cash_closings': {
        get: {
          operationId: 'get_cash_closings',
          summary: 'Lista Apurações Financeiras de uma entidade, ordenadas da mais recente para a mais antiga. Use para "qual foi a última apuração?" (primeiro item retornado) ou filtrando por período.',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'date_from', in: 'query', required: false, schema: { type: 'string' }, description: 'Data inicial YYYY-MM-DD' },
            { name: 'date_to', in: 'query', required: false, schema: { type: 'string' }, description: 'Data final YYYY-MM-DD' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' }, description: 'Máximo de resultados (padrão: 20)' },
          ],
          responses: { '200': { description: 'Lista de apurações financeiras' } },
        },
      },
      '/actions/get_cash_closing_detail': {
        get: {
          operationId: 'get_cash_closing_detail',
          summary: 'Busca o detalhe completo de uma Apuração Financeira específica (formas de pagamento e movimentos). Localiza por entity_id + date; use shift_label para desambiguar se houver mais de um turno na mesma data.',
          parameters: [
            { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'date', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
            { name: 'shift_label', in: 'query', required: false, schema: { type: 'string' }, description: 'Obrigatório apenas se houver mais de uma apuração na mesma data' },
          ],
          responses: { '200': { description: 'Detalhe da apuração, com payments[] e movements[]' } },
        },
      },
      '/actions/update_cash_closing': {
        post: {
          operationId: 'update_cash_closing',
          summary: 'Edita uma Apuração Financeira existente. Bloqueado se já convertida (total ou parcialmente) em lançamentos. Localiza por entity_id + date (+ shift_label se ambíguo). Campos não informados mantêm o valor atual; payments/movements, se enviados, substituem a lista existente.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entity_id', 'date'],
                  properties: {
                    entity_id: { type: 'string' },
                    date: { type: 'string', description: 'YYYY-MM-DD — data da apuração a editar' },
                    shift_label: { type: 'string', description: 'Obrigatório apenas se houver mais de uma apuração na mesma data' },
                    responsible: { type: 'string' },
                    total_sales: { type: 'number' },
                    payments: {
                      type: 'array',
                      description: 'Lista completa de formas de pagamento não-dinheiro — substitui a lista existente se enviada',
                      items: {
                        type: 'object',
                        properties: {
                          payment_method_id: { type: 'string' },
                          amount: { type: 'number' },
                        },
                      },
                    },
                    movements: {
                      type: 'array',
                      description: 'Lista completa de entradas/saídas — substitui a lista existente se enviada',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['in', 'out'] },
                          amount: { type: 'number' },
                          description: { type: 'string' },
                        },
                      },
                    },
                    counted_cash: { type: 'number' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Apuração atualizada' },
            '409': { description: 'Bloqueado — apuração já convertida (total ou parcialmente)' },
          },
        },
      },
    },
  });
});
