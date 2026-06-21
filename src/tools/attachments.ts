import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { AuthContext, validateEntityAccess } from '../auth.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function getMimeExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
  };
  return map[mimeType] ?? 'bin';
}

function getExtensionFromFileName(fileName: string): string | null {
  const parts = fileName.split('.');
  if (parts.length < 2) return null;
  return parts.pop()!.toLowerCase();
}

export function registerAttachmentTools(server: McpServer, getAuth: () => AuthContext) {
  server.tool(
    'attach_document',
    'Anexa um documento (recibo, nota fiscal, comprovante) a um lançamento existente. ' +
    'O arquivo deve ser enviado em base64. ' +
    'Tipos aceitos: application/pdf, image/jpeg, image/jpg, image/png. ' +
    'Tamanho máximo: 10MB.',
    {
      entity_id: z.string().uuid().describe('ID da entidade dona do lançamento'),
      transaction_id: z.string().uuid().describe('ID do lançamento ao qual o documento será anexado'),
      file_content: z.string().describe('Conteúdo do arquivo codificado em base64'),
      file_name: z.string().describe('Nome original do arquivo (ex: recibo.pdf, nota.png)'),
      file_mime_type: z.enum([
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
      ]).describe('Tipo MIME do arquivo'),
    },
    async ({ entity_id, transaction_id, file_content, file_name, file_mime_type }) => {
      const auth = getAuth();

      // 1. Validar acesso à entidade (lança exceção se negado)
      await validateEntityAccess(auth, entity_id);

      // 2. Decodificar base64
      let fileBuffer: Buffer;
      try {
        fileBuffer = Buffer.from(file_content, 'base64');
      } catch {
        throw new Error('Conteúdo base64 inválido. Verifique se o arquivo foi codificado corretamente.');
      }

      // 3. Validar tamanho
      if (fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
        const sizeMB = (fileBuffer.byteLength / 1024 / 1024).toFixed(2);
        throw new Error(`Arquivo muito grande: ${sizeMB}MB. Tamanho máximo permitido: 10MB.`);
      }

      // 4. Verificar que a transação pertence à entidade
      const { data: transaction, error: txError } = await supabase
        .from('transactions')
        .select('id, description')
        .eq('id', transaction_id)
        .eq('entity_id', entity_id)
        .single();

      if (txError || !transaction) {
        throw new Error(`Lançamento ${transaction_id} não encontrado na entidade ${entity_id}.`);
      }

      // 5. Montar path do arquivo
      const ext = getExtensionFromFileName(file_name) ?? getMimeExtension(file_mime_type);
      const storagePath = `${entity_id}/${transaction_id}/${Date.now()}.${ext}`;

      // 6. Upload no Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('transaction-attachments')
        .upload(storagePath, fileBuffer, {
          contentType: file_mime_type,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Falha no upload do arquivo: ${uploadError.message}`);
      }

      // 7. Atualizar os campos de anexo na transação
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          attachment_url: storagePath,
          attachment_name: file_name,
          attachment_type: file_mime_type,
        })
        .eq('id', transaction_id);

      if (updateError) {
        throw new Error(
          `Arquivo salvo no storage mas falha ao vincular ao lançamento: ${updateError.message}. ` +
          `Path do arquivo: ${storagePath}`
        );
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            attachment_url: storagePath,
            attachment_name: file_name,
            attachment_type: file_mime_type,
            message: `Documento "${file_name}" anexado com sucesso ao lançamento "${transaction.description}".`,
          }, null, 2),
        }],
      };
    }
  );
}
