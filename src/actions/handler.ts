import { Router, Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { validateApiKey, validateEntityAccess, AuthContext } from '../auth.js';

// Middleware de autenticação compartilhado
async function getAuth(req: Request, res: Response): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authorization header ausente' });
    return null;
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    if (token.startsWith('fincore_')) {
      return await validateApiKey(authHeader);
    } else {
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('id, user_id, entity_ids, revoked_at')
        .eq('key_hash', token)
        .is('revoked_at', null)
        .single();

      if (error || !data) {
        res.status(401).json({ success: false, error: 'Token inválido ou revogado' });
        return null;
      }

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
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message ?? 'Unauthorized' });
    return null;
  }
}

function ok(res: Response, data: any) {
  res.json({ success: true, data });
}

function fail(res: Response, error: any, status = 500) {
  res.status(status).json({ success: false, error: error?.message ?? String(error) });
}

export const actionsRouter = Router();

// ─── ENTITIES ────────────────────────────────────────────────────────────────

actionsRouter.get('/actions/list_entities', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { data: owned, error: ownedError } = await supabase
      .from('entities')
      .select('id, name, type, color')
      .eq('owner_id', auth.user_id)
      .order('name');

    if (ownedError) throw new Error(ownedError.message);

    const { data: memberLinks, error: memberError } = await supabase
      .from('entity_members')
      .select('entity_id, role')
      .eq('user_id', auth.user_id);

    if (memberError) throw new Error(memberError.message);

    const memberEntityIds = (memberLinks ?? []).map((m) => m.entity_id);
    let memberEntities: any[] = [];

    if (memberEntityIds.length > 0) {
      const { data: entData, error: entError } = await supabase
        .from('entities')
        .select('id, name, type, color, owner_id')
        .in('id', memberEntityIds)
        .neq('owner_id', auth.user_id);

      if (entError) throw new Error(entError.message);

      memberEntities = (entData ?? []).map((e) => {
        const link = memberLinks!.find((m) => m.entity_id === e.id);
        return { id: e.id, name: e.name, type: e.type, color: e.color, access: link?.role ?? 'member' };
      });
    }

    const all = [
      ...(owned ?? []).map((e) => ({ id: e.id, name: e.name, type: e.type, color: e.color, access: 'owner' })),
      ...memberEntities,
    ];

    const filtered = auth.entity_ids ? all.filter((e) => auth.entity_ids!.includes(e.id)) : all;
    ok(res, { entities: filtered });
  } catch (err) {
    fail(res, err);
  }
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

actionsRouter.get('/actions/get_transactions', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, date_from, date_to, type, status } = req.query as Record<string, string>;
    if (!entity_id || !date_from || !date_to) {
      return fail(res, new Error('entity_id, date_from e date_to são obrigatórios'), 400);
    }

    await validateEntityAccess(auth, entity_id);

    let query = supabase
      .from('transactions')
      .select('id, description, amount, type, status, date, due_date, paid_date, notes, category_id, bank_account_id, payment_method_id, supplier_id, client_id')
      .eq('entity_id', entity_id)
      .gte('date', date_from)
      .lte('date', date_to)
      .order('date', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const transactions = data ?? [];
    const total_income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount ?? 0), 0);
    const total_expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount ?? 0), 0);

    ok(res, {
      period: { from: date_from, to: date_to },
      summary: { total_income, total_expense, balance: total_income - total_expense, count: transactions.length },
      transactions,
    });
  } catch (err) {
    fail(res, err);
  }
});

actionsRouter.post('/actions/create_transaction', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, description, amount, type, date, status, category_id, bank_account_id, payment_method_id, supplier_id, client_id, due_date, notes } = req.body;

    if (!entity_id || !description || !amount || !type || !date || !status || !category_id || !bank_account_id) {
      return fail(res, new Error('Campos obrigatórios: entity_id, description, amount, type, date, status, category_id, bank_account_id'), 400);
    }
    if (type === 'income' && !payment_method_id) {
      return fail(res, new Error('payment_method_id é obrigatório para receitas'), 400);
    }

    await validateEntityAccess(auth, entity_id);

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        entity_id, description, amount, net_amount: amount, type, date, status,
        category_id, bank_account_id,
        payment_method_id: payment_method_id ?? null,
        supplier_id: supplier_id ?? null,
        client_id: client_id ?? null,
        due_date: due_date ?? date,
        notes: notes ?? null,
        recurrence_type: 'none',
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    ok(res, { message: `Lançamento "${description}" criado com sucesso.`, transaction: data });
  } catch (err) {
    fail(res, err);
  }
});

actionsRouter.post('/actions/update_transaction_status', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, transaction_id, status, paid_date } = req.body;
    if (!entity_id || !transaction_id || !status) {
      return fail(res, new Error('entity_id, transaction_id e status são obrigatórios'), 400);
    }

    await validateEntityAccess(auth, entity_id);

    const { data: existing, error: fetchError } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('id', transaction_id)
      .eq('entity_id', entity_id)
      .single();

    if (fetchError || !existing) throw new Error('Lançamento não encontrado');

    const updateData: any = { status };
    if (status === 'paid') updateData.paid_date = paid_date ?? new Date().toISOString().split('T')[0];

    const { error } = await supabase.from('transactions').update(updateData).eq('id', transaction_id).eq('entity_id', entity_id);
    if (error) throw new Error(error.message);

    ok(res, { message: `Lançamento "${existing.description}" atualizado para ${status}.` });
  } catch (err) {
    fail(res, err);
  }
});

actionsRouter.post('/actions/update_transaction', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, transaction_id, scope = 'only', description, amount, date, due_date, status, paid_date, category_id, bank_account_id, payment_method_id, supplier_id, client_id, notes } = req.body;
    if (!entity_id || !transaction_id) return fail(res, new Error('entity_id e transaction_id são obrigatórios'), 400);

    await validateEntityAccess(auth, entity_id);

    const { data: existing, error: fetchError } = await supabase
      .from('transactions')
      .select('id, description, recurrence_rule_id, date')
      .eq('id', transaction_id)
      .eq('entity_id', entity_id)
      .single();

    if (fetchError || !existing) throw new Error('Lançamento não encontrado');

    const updateData: any = {};
    if (description !== undefined) updateData.description = description;
    if (amount !== undefined) { updateData.amount = amount; updateData.net_amount = amount; }
    if (date !== undefined) updateData.date = date;
    if (due_date !== undefined) updateData.due_date = due_date;
    if (status !== undefined) updateData.status = status;
    if (status === 'paid') updateData.paid_date = paid_date ?? new Date().toISOString().split('T')[0];
    if (category_id !== undefined) updateData.category_id = category_id;
    if (bank_account_id !== undefined) updateData.bank_account_id = bank_account_id;
    if (payment_method_id !== undefined) updateData.payment_method_id = payment_method_id;
    if (supplier_id !== undefined) updateData.supplier_id = supplier_id;
    if (client_id !== undefined) updateData.client_id = client_id;
    if (notes !== undefined) updateData.notes = notes;

    if (Object.keys(updateData).length === 0) throw new Error('Nenhum campo para atualizar');

    const { error } = await supabase.from('transactions').update(updateData).eq('id', transaction_id).eq('entity_id', entity_id);
    if (error) throw new Error(error.message);

    if (existing.recurrence_rule_id && scope !== 'only') {
      const propagate: any = {};
      if (description !== undefined) propagate.description = description;
      if (amount !== undefined) { propagate.amount = amount; propagate.net_amount = amount; }
      if (category_id !== undefined) propagate.category_id = category_id;
      if (bank_account_id !== undefined) propagate.bank_account_id = bank_account_id;
      if (payment_method_id !== undefined) propagate.payment_method_id = payment_method_id;
      if (supplier_id !== undefined) propagate.supplier_id = supplier_id;
      if (client_id !== undefined) propagate.client_id = client_id;

      if (Object.keys(propagate).length > 0) {
        let q = supabase.from('transactions').update(propagate)
          .eq('recurrence_rule_id', existing.recurrence_rule_id)
          .eq('entity_id', entity_id)
          .eq('status', 'pending')
          .neq('id', transaction_id);
        if (scope === 'future') q = q.gte('date', existing.date);
        const { error: seriesError } = await q;
        if (seriesError) throw new Error(seriesError.message);
      }
    }

    ok(res, { message: scope === 'only' ? 'Lançamento atualizado.' : `Lançamento e ${scope === 'future' ? 'futuros pendentes' : 'todos os pendentes da série'} atualizados.` });
  } catch (err) {
    fail(res, err);
  }
});

actionsRouter.post('/actions/delete_transaction', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, transaction_id } = req.body;
    if (!entity_id || !transaction_id) return fail(res, new Error('entity_id e transaction_id são obrigatórios'), 400);

    await validateEntityAccess(auth, entity_id);

    const { data: existing, error: fetchError } = await supabase
      .from('transactions').select('id, description, amount').eq('id', transaction_id).eq('entity_id', entity_id).single();
    if (fetchError || !existing) throw new Error('Lançamento não encontrado');

    const { error } = await supabase.from('transactions').delete().eq('id', transaction_id).eq('entity_id', entity_id);
    if (error) throw new Error(error.message);

    ok(res, { message: `Lançamento "${existing.description}" apagado com sucesso.` });
  } catch (err) {
    fail(res, err);
  }
});

actionsRouter.post('/actions/import_statement', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, bank_account_id, transactions } = req.body;
    if (!entity_id || !bank_account_id || !Array.isArray(transactions) || transactions.length === 0) {
      return fail(res, new Error('entity_id, bank_account_id e transactions[] são obrigatórios'), 400);
    }
    if (transactions.length > 200) return fail(res, new Error('Máximo de 200 itens por importação'), 400);

    await validateEntityAccess(auth, entity_id);

    const rows = transactions.map((t: any) => ({
      entity_id, bank_account_id,
      description: t.description, amount: t.amount, type: t.type,
      date: t.date, status: t.status ?? 'paid',
      category_id: t.category_id ?? null,
      recurrence_type: 'none',
    }));

    const { data, error } = await supabase.from('transactions').insert(rows).select('id, description, amount, type, date');
    if (error) throw new Error(error.message);

    const imported = data ?? [];
    ok(res, {
      message: `${imported.length} lançamentos importados com sucesso.`,
      summary: {
        imported_count: imported.length,
        total_income: imported.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount ?? 0), 0),
        total_expense: imported.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount ?? 0), 0),
      },
      transactions: imported,
    });
  } catch (err) {
    fail(res, err);
  }
});

actionsRouter.post('/actions/create_recurring_transaction', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;

  try {
    const { entity_id, description, amount, type, start_date, frequency, duration_type = 'indeterminate', recurrence_count, category_id, bank_account_id, payment_method_id, supplier_id, client_id, notes } = req.body;

    if (!entity_id || !description || !amount || !type || !start_date || !frequency || !category_id || !bank_account_id) {
      return fail(res, new Error('Campos obrigatórios ausentes'), 400);
    }
    if (duration_type === 'fixed' && !recurrence_count) {
      return fail(res, new Error('recurrence_count é obrigatório quando duration_type=fixed'), 400);
    }

    await validateEntityAccess(auth, entity_id);

    const totalCount = duration_type === 'fixed' ? recurrence_count : 12;

    function generateDates(startDate: string, freq: string, count: number): string[] {
      const dates: string[] = [];
      const start = new Date(startDate + 'T12:00:00Z');
      for (let i = 0; i < count; i++) {
        const d = new Date(start);
        if (freq === 'daily') d.setUTCDate(d.getUTCDate() + i);
        if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + i * 7);
        if (freq === 'monthly') d.setUTCMonth(d.getUTCMonth() + i);
        if (freq === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + i);
        dates.push(d.toISOString().split('T')[0]);
      }
      return dates;
    }

    const allDates = generateDates(start_date, frequency, totalCount);
    const end_date = duration_type === 'fixed' ? allDates[allDates.length - 1] : null;
    const day_of_month = ['monthly', 'yearly'].includes(frequency) ? new Date(start_date + 'T12:00:00Z').getUTCDate() : null;
    const day_of_week = frequency === 'weekly' ? new Date(start_date + 'T12:00:00Z').getUTCDay() : null;

    const { data: rule, error: ruleError } = await supabase
      .from('recurrence_rules')
      .insert({ entity_id, frequency, interval_count: 1, day_of_month, day_of_week, start_date, end_date, is_active: true, type: 'recurring' })
      .select().single();

    if (ruleError) throw new Error(ruleError.message);

    const rows = allDates.map((date, index) => ({
      entity_id, description, amount, net_amount: amount, type, date, due_date: date,
      status: 'pending', recurrence_type: 'none', recurrence_rule_id: rule.id,
      installments: duration_type === 'fixed' ? recurrence_count : null,
      current_installment: duration_type === 'fixed' ? index + 1 : null,
      category_id, bank_account_id,
      payment_method_id: payment_method_id ?? null,
      supplier_id: supplier_id ?? null,
      client_id: client_id ?? null,
      notes: notes ?? null,
    }));

    const { data: txs, error: txError } = await supabase.from('transactions').insert(rows).select('id, date, current_installment');
    if (txError) {
      await supabase.from('recurrence_rules').delete().eq('id', rule.id);
      throw new Error(txError.message);
    }

    ok(res, {
      message: `Lançamento recorrente "${description}" criado. ${totalCount} lançamentos materializados.`,
      recurrence_rule_id: rule.id,
      total_created: (txs ?? []).length,
      first_date: allDates[0],
      last_date: allDates[allDates.length - 1],
    });
  } catch (err) {
    fail(res, err);
  }
});

// ─── CATEGORIES / ACCOUNTS / PAYMENT METHODS / SUPPLIERS / CLIENTS ───────────

actionsRouter.get('/actions/get_categories', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, type } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    let query = supabase.from('categories').select('id, name, type, color, icon, keywords, financial_classification').eq('entity_id', entity_id).order('name');
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    ok(res, { categories: data ?? [] });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_bank_accounts', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase.from('bank_accounts').select('id, name, bank_name, account_type, type, current_balance, is_default, is_active').eq('entity_id', entity_id).eq('is_active', true).order('is_default', { ascending: false });
    if (error) throw new Error(error.message);
    ok(res, { bank_accounts: data ?? [] });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_payment_methods', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase.from('payment_methods').select('id, name, status_behavior').eq('entity_id', entity_id).eq('is_active', true).order('name');
    if (error) throw new Error(error.message);
    ok(res, { payment_methods: data ?? [] });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_suppliers', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, search } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    let query = supabase.from('suppliers').select('id, name, email, phone').eq('entity_id', entity_id).order('name');
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    ok(res, { suppliers: data ?? [] });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_clients', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, search } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    let query = supabase.from('clients').select('id, name, email, phone, document').eq('entity_id', entity_id).order('name');
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    ok(res, { clients: data ?? [] });
  } catch (err) { fail(res, err); }
});

// ─── CREATE CATEGORY / SUPPLIER / CLIENT ─────────────────────────────────────

actionsRouter.post('/actions/create_category', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, name, type, color, icon, keywords, financial_classification } = req.body;
    if (!entity_id || !name || !type) {
      return fail(res, new Error('entity_id, name e type são obrigatórios'), 400);
    }
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase
      .from('categories')
      .insert({
        entity_id, name, type,
        color: color ?? '#6366f1',
        icon: icon ?? 'tag',
        keywords: keywords ?? [],
        financial_classification: financial_classification ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    ok(res, { message: `Categoria "${name}" criada com sucesso.`, category: data });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/create_supplier', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, name, email, phone, address, document, notes } = req.body;
    if (!entity_id || !name) {
      return fail(res, new Error('entity_id e name são obrigatórios'), 400);
    }
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        entity_id, owner_id: auth.user_id, name,
        email: email ?? null, phone: phone ?? null,
        address: address ?? null, document: document ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    ok(res, { message: `Fornecedor "${name}" cadastrado com sucesso.`, supplier: data });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/create_client', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, name, email, phone, address, document, notes } = req.body;
    if (!entity_id || !name) {
      return fail(res, new Error('entity_id e name são obrigatórios'), 400);
    }
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase
      .from('clients')
      .insert({
        entity_id, owner_id: auth.user_id, name,
        email: email ?? null, phone: phone ?? null,
        address: address ?? null, document: document ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    ok(res, { message: `Cliente "${name}" cadastrado com sucesso.`, client: data });
  } catch (err) { fail(res, err); }
});

// ─── ATTACH DOCUMENT ─────────────────────────────────────────────────────────

actionsRouter.post('/actions/attach_document', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, transaction_id, file_content, file_name, file_mime_type } = req.body;

    if (!entity_id || !transaction_id || !file_content || !file_name || !file_mime_type) {
      return fail(res, new Error('entity_id, transaction_id, file_content, file_name e file_mime_type são obrigatórios'), 400);
    }

    const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!ALLOWED_MIME_TYPES.includes(file_mime_type)) {
      return fail(res, new Error(`Tipo não suportado: ${file_mime_type}. Aceitos: ${ALLOWED_MIME_TYPES.join(', ')}`), 400);
    }

    await validateEntityAccess(auth, entity_id);

    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(file_content, 'base64');
    } catch {
      return fail(res, new Error('Conteúdo base64 inválido'), 400);
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (fileBuffer.byteLength > MAX_SIZE) {
      const sizeMB = (fileBuffer.byteLength / 1024 / 1024).toFixed(2);
      return fail(res, new Error(`Arquivo muito grande: ${sizeMB}MB. Máximo: 10MB`), 400);
    }

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('id', transaction_id)
      .eq('entity_id', entity_id)
      .single();

    if (txError || !transaction) {
      return fail(res, new Error(`Lançamento ${transaction_id} não encontrado na entidade ${entity_id}`), 404);
    }

    const ext = file_name.split('.').pop()?.toLowerCase() ?? file_mime_type.split('/')[1];
    const storagePath = `${entity_id}/${transaction_id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('transaction-attachments')
      .upload(storagePath, fileBuffer, {
        contentType: file_mime_type,
        upsert: true,
      });

    if (uploadError) throw new Error(`Falha no upload: ${uploadError.message}`);

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        attachment_url: storagePath,
        attachment_name: file_name,
        attachment_type: file_mime_type,
      })
      .eq('id', transaction_id);

    if (updateError) {
      throw new Error(`Arquivo salvo mas falha ao vincular ao lançamento: ${updateError.message}. Path: ${storagePath}`);
    }

    ok(res, {
      message: `Documento "${file_name}" anexado com sucesso ao lançamento "${transaction.description}".`,
      attachment_url: storagePath,
      attachment_name: file_name,
      attachment_type: file_mime_type,
    });
  } catch (err) { fail(res, err); }
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────

actionsRouter.get('/actions/get_summary', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, year, month } = req.query as Record<string, string>;
    if (!entity_id || !year || !month) return fail(res, new Error('entity_id, year e month são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const y = parseInt(year), m = parseInt(month);
    const date_from = `${y}-${String(m).padStart(2, '0')}-01`;
    const date_to = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
    const { data, error } = await supabase.from('transactions').select('amount, type, status').eq('entity_id', entity_id).gte('date', date_from).lte('date', date_to);
    if (error) throw new Error(error.message);
    const txs = data ?? [];
    const total_income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount ?? 0), 0);
    const total_expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount ?? 0), 0);
    const paid_income = txs.filter((t) => t.type === 'income' && t.status === 'paid').reduce((s, t) => s + (t.amount ?? 0), 0);
    const paid_expense = txs.filter((t) => t.type === 'expense' && t.status === 'paid').reduce((s, t) => s + (t.amount ?? 0), 0);
    ok(res, { period: { year: y, month: m, date_from, date_to }, summary: { total_income, total_expense, balance: total_income - total_expense, paid_income, paid_expense, real_balance: paid_income - paid_expense, transaction_count: txs.length } });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_financial_indicators', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, year, month } = req.query as Record<string, string>;
    if (!entity_id || !year || !month) return fail(res, new Error('entity_id, year e month são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const y = parseInt(year), m = parseInt(month);
    const date_from = `${y}-${String(m).padStart(2, '0')}-01`;
    const date_to = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
    const { data, error } = await supabase.from('transactions').select('amount, type, status, category_id, categories!left(financial_classification)').eq('entity_id', entity_id).gte('date', date_from).lte('date', date_to).eq('status', 'paid');
    if (error) throw new Error(error.message);
    const txs = data ?? [];
    const receita_total = txs.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount ?? 0), 0);
    const getClass = (c: string) => txs.filter((t) => t.type === 'expense' && (t as any).categories?.financial_classification === c).reduce((s, t) => s + (t.amount ?? 0), 0);
    const cmv = getClass('cmv'), csp = getClass('csp'), custos_variaveis = getClass('variable_cost'), custos_fixos = getClass('fixed_cost'), investimentos = getClass('investment');
    const sem_classificacao = txs.filter((t) => t.type === 'expense' && !(t as any).categories?.financial_classification).reduce((s, t) => s + (t.amount ?? 0), 0);
    const despesa_total = cmv + csp + custos_variaveis + custos_fixos + investimentos + sem_classificacao;
    const lucro_bruto = receita_total - cmv - csp;
    const lucro_liquido = receita_total - despesa_total;
    ok(res, { period: { year: y, month: m }, indicators: { receita_total: receita_total.toFixed(2), despesa_total: despesa_total.toFixed(2), lucro_bruto: lucro_bruto.toFixed(2), lucro_liquido: lucro_liquido.toFixed(2), margem_bruta_percentual: (receita_total > 0 ? (lucro_bruto / receita_total) * 100 : 0).toFixed(1) + '%', margem_liquida_percentual: (receita_total > 0 ? (lucro_liquido / receita_total) * 100 : 0).toFixed(1) + '%', cmv: cmv.toFixed(2), csp: csp.toFixed(2), custos_fixos: custos_fixos.toFixed(2), custos_variaveis: custos_variaveis.toFixed(2), investimentos: investimentos.toFixed(2) } });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_goals', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase.from('financial_goals').select('id, title, target_amount, current_amount, target_date, status, color, frequency').eq('entity_id', entity_id).order('target_date');
    if (error) throw new Error(error.message);
    ok(res, { goals: (data ?? []).map((g) => ({ ...g, progress_percentual: g.target_amount > 0 ? ((g.current_amount / g.target_amount) * 100).toFixed(1) + '%' : '0%', remaining: (g.target_amount - g.current_amount).toFixed(2) })) });
  } catch (err) { fail(res, err); }
});

actionsRouter.get('/actions/get_spending_limits', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, year, month } = req.query as Record<string, string>;
    if (!entity_id) return fail(res, new Error('entity_id é obrigatório'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data: limits, error } = await supabase.from('category_spending_limits').select('id, category_id, amount, categories!left(name, financial_classification)').eq('entity_id', entity_id);
    if (error) throw new Error(error.message);
    let spentByCategory: Record<string, number> = {};
    if (year && month) {
      const y = parseInt(year), m = parseInt(month);
      const date_from = `${y}-${String(m).padStart(2, '0')}-01`;
      const date_to = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
      const { data: txs } = await supabase.from('transactions').select('category_id, amount').eq('entity_id', entity_id).eq('type', 'expense').eq('status', 'paid').gte('date', date_from).lte('date', date_to);
      (txs ?? []).forEach((t) => { if (t.category_id) spentByCategory[t.category_id] = (spentByCategory[t.category_id] ?? 0) + (t.amount ?? 0); });
    }
    ok(res, { spending_limits: (limits ?? []).map((l: any) => { const spent = spentByCategory[l.category_id] ?? null; return { category_id: l.category_id, category_name: l.categories?.name ?? 'Sem nome', limit_amount: l.amount, spent_amount: spent, remaining: spent !== null ? (l.amount - spent).toFixed(2) : null, status: spent !== null ? spent > l.amount ? 'acima_do_limite' : spent > l.amount * 0.8 ? 'proximo_do_limite' : 'dentro_do_limite' : null }; }) });
  } catch (err) { fail(res, err); }
});

// ─── CALENDAR ─────────────────────────────────────────────────────────────────

actionsRouter.get('/actions/get_calendar_events', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, date_from, date_to } = req.query as Record<string, string>;
    if (!entity_id || !date_from || !date_to) return fail(res, new Error('entity_id, date_from e date_to são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase.from('calendar_events').select('id, title, date, time, description, color, status').eq('entity_id', entity_id).gte('date', date_from).lte('date', date_to).order('date').order('time');
    if (error) throw new Error(error.message);
    ok(res, { events: data ?? [] });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/create_calendar_event', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, title, date, time, description, color } = req.body;
    if (!entity_id || !title || !date) return fail(res, new Error('entity_id, title e date são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data, error } = await supabase.from('calendar_events').insert({ entity_id, title, date, time: time ?? null, description: description ?? null, color: color ?? '#3b82f6', status: 'pending' }).select().single();
    if (error) throw new Error(error.message);
    ok(res, { message: `Agendamento "${title}" criado para ${date}.`, event: data });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/create_calendar_reminder', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, event_id, minutes_before = 30 } = req.body;
    if (!entity_id || !event_id) return fail(res, new Error('entity_id e event_id são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data: existing, error: fetchError } = await supabase.from('calendar_events').select('id, title, date, time').eq('id', event_id).eq('entity_id', entity_id).single();
    if (fetchError || !existing) throw new Error('Agendamento não encontrado');
    let remind_at: string | null = null;
    if (existing.date && existing.time) {
      const dt = new Date(`${existing.date}T${existing.time}:00`);
      dt.setMinutes(dt.getMinutes() - minutes_before);
      remind_at = dt.toISOString();
    }
    const { data, error } = await supabase.from('calendar_reminders').insert({ event_id, minutes_before, remind_at, is_notified: false }).select().single();
    if (error) throw new Error(error.message);
    ok(res, { message: `Lembrete de ${minutes_before} minutos criado para "${existing.title}".`, reminder: data });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/update_calendar_event', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, event_id, title, description, date, time, status, color, notes } = req.body;
    if (!entity_id || !event_id) return fail(res, new Error('entity_id e event_id são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data: existing, error: fetchError } = await supabase.from('calendar_events').select('id, title, date, time').eq('id', event_id).eq('entity_id', entity_id).single();
    if (fetchError || !existing) throw new Error('Agendamento não encontrado');
    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (date !== undefined) updateData.date = date;
    if (time !== undefined) updateData.time = time === '' ? null : time;
    if (status !== undefined) updateData.status = status;
    if (color !== undefined) updateData.color = color;
    if (notes !== undefined) updateData.notes = notes;
    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase.from('calendar_events').update(updateData).eq('id', event_id).eq('entity_id', entity_id);
      if (error) throw new Error(error.message);
    }
    ok(res, { message: `Agendamento "${title ?? existing.title}" atualizado.` });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/update_calendar_event_status', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, event_id, status } = req.body;
    if (!entity_id || !event_id || !status) return fail(res, new Error('entity_id, event_id e status são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data: existing, error: fetchError } = await supabase.from('calendar_events').select('id, title').eq('id', event_id).eq('entity_id', entity_id).single();
    if (fetchError || !existing) throw new Error('Agendamento não encontrado');
    const { error } = await supabase.from('calendar_events').update({ status }).eq('id', event_id).eq('entity_id', entity_id);
    if (error) throw new Error(error.message);
    ok(res, { message: `Agendamento "${existing.title}" atualizado para ${status}.` });
  } catch (err) { fail(res, err); }
});

actionsRouter.post('/actions/delete_calendar_event', async (req, res) => {
  const auth = await getAuth(req, res);
  if (!auth) return;
  try {
    const { entity_id, event_id } = req.body;
    if (!entity_id || !event_id) return fail(res, new Error('entity_id e event_id são obrigatórios'), 400);
    await validateEntityAccess(auth, entity_id);
    const { data: existing, error: fetchError } = await supabase.from('calendar_events').select('id, title').eq('id', event_id).eq('entity_id', entity_id).single();
    if (fetchError || !existing) throw new Error('Agendamento não encontrado');
    await supabase.from('calendar_reminders').delete().eq('event_id', event_id);
    const { error } = await supabase.from('calendar_events').delete().eq('id', event_id).eq('entity_id', entity_id);
    if (error) throw new Error(error.message);
    ok(res, { message: `Agendamento "${existing.title}" apagado com sucesso.` });
  } catch (err) { fail(res, err); }
});
