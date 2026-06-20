import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import { supabase } from './supabase.js';

export const oauthRouter = Router();

const APP_URL = 'https://mcp.fincore.app.br';

// OAuth discovery — obrigatório para o claude.ai encontrar os endpoints
oauthRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: APP_URL,
    authorization_endpoint: `${APP_URL}/oauth/authorize`,
    token_endpoint: `${APP_URL}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
  });
});

// Página de autorização — usuário cola a API Key aqui
oauthRouter.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state } = req.query;

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conectar Claude ao Fincore</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
    }
    .logo { font-size: 32px; margin-bottom: 8px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    p { color: #999; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #ccc; }
    input {
      width: 100%;
      padding: 12px 16px;
      background: #0f0f0f;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: monospace;
      margin-bottom: 20px;
      outline: none;
    }
    input:focus { border-color: #f97316; }
    button {
      width: 100%;
      padding: 14px;
      background: #f97316;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #ea6c0a; }
    .hint { margin-top: 16px; font-size: 12px; color: #666; text-align: center; }
    .hint a { color: #f97316; text-decoration: none; }
    .error {
      background: #3a1a1a;
      border: 1px solid #dc2626;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      color: #f87171;
      margin-bottom: 16px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔗</div>
    <h1>Conectar Claude ao Fincore</h1>
    <p>Cole sua API Key do Fincore para autorizar o acesso. Gere uma em <strong>Configurações → Integrações → Claude</strong>.</p>
    <div class="error" id="error"></div>
    <form id="form">
      <label>API Key do Fincore</label>
      <input
        type="password"
        id="apiKey"
        placeholder="fincore_..."
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" id="btn">Autorizar acesso</button>
    </form>
    <p class="hint">
      Não tem uma API Key?
      <a href="https://app.fincore.app.br/settings?tab=integration" target="_blank">
        Gerar no Fincore
      </a>
    </p>
  </div>
  <script>
    const form = document.getElementById('form');
    const btn = document.getElementById('btn');
    const errorEl = document.getElementById('error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiKey = document.getElementById('apiKey').value.trim();
      if (!apiKey.startsWith('fincore_')) {
        errorEl.textContent = 'API Key inválida. Deve começar com fincore_';
        errorEl.style.display = 'block';
        return;
      }

      btn.textContent = 'Verificando...';
      btn.disabled = true;
      errorEl.style.display = 'none';

      try {
        const res = await fetch('/oauth/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            redirect_uri: '${redirect_uri}',
            state: '${state}',
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.error ?? 'Erro ao validar API Key';
          errorEl.style.display = 'block';
          btn.textContent = 'Autorizar acesso';
          btn.disabled = false;
          return;
        }

        window.location.href = data.redirect_url;
      } catch {
        errorEl.textContent = 'Erro de conexão. Tente novamente.';
        errorEl.style.display = 'block';
        btn.textContent = 'Autorizar acesso';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>
  `;

  res.send(html);
});

// Valida a API Key e gera código de autorização
oauthRouter.post('/oauth/validate', async (req, res) => {
  const { api_key, redirect_uri, state } = req.body;

  if (!api_key || !api_key.startsWith('fincore_')) {
    res.status(400).json({ error: 'API Key inválida' });
    return;
  }

  const keyHash = createHash('sha256').update(api_key).digest('hex');
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    res.status(401).json({ error: 'API Key inválida ou revogada' });
    return;
  }

  const code = randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase.from('mcp_oauth_codes').insert({
    code,
    api_key_hash: keyHash,
    user_id: data.user_id,
    expires_at,
  });

  const redirect_url = `${redirect_uri}?code=${code}&state=${state}`;
  res.json({ redirect_url });
});

// Troca código por token de acesso
oauthRouter.post('/oauth/token', async (req, res) => {
  const { code, grant_type } = req.body;

  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'grant_type inválido' });
    return;
  }

  const { data, error } = await supabase
    .from('mcp_oauth_codes')
    .select('*')
    .eq('code', code)
    .single();

  if (error || !data) {
    res.status(401).json({ error: 'Código inválido ou expirado' });
    return;
  }

  if (new Date(data.expires_at) < new Date()) {
    res.status(401).json({ error: 'Código expirado' });
    return;
  }

  await supabase.from('mcp_oauth_codes').delete().eq('code', code);

  res.json({
    access_token: data.api_key_hash,
    token_type: 'bearer',
    expires_in: 31536000,
  });
});
