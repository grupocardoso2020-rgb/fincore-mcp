import { supabase } from '../supabase.js';
import { validateEntityAccess } from '../auth.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
];

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

export const attachDocumentTool = {
  name: 'attach_document',
  description:
    'Anexa um documento (recibo, nota fiscal, comprovante) a um lançamento existente. ' +
    'O arquivo deve ser enviado em base64. ' +
    'Tipos aceitos: application/pdf, image/jpeg, image/png. ' +
    'Tamanho máximo: 10MB.',
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: {
        type: 'string',
        description: 'ID da entidade dona do lançamento (UUID)',
      },
      transaction_id: {
        type: 'string',
        description: 'ID do lançamento ao qual o documento será anexado (UUID)',
      },
      file_content: {
        type: 'string',
        description: 'Conteúdo do arquivo codificado em base64',
      },
      file_name: {
        type: 'string',
        description: 'Nome original do arquivo (ex: recibo.pdf, nota.png)',
      },
      file_mime_type: {
        type: 'string',
        description:
          'Tipo MIME do arquivo. Aceitos: application/pdf, image/jpeg, image/jpg, image/png',
      },
    },
    required: [
      'entity_id',
      'transaction_id',
      'file_content',
      'file_name',
      'file_mime_type',
    ],
  },
};

export async function handleAttachDocument(
  args: {
    entity_id: string;
    transaction_id: string;
    file_content: string;
    file_name: string;
    file_mime_type: string;
  },
  apiKeyHash: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { entity_id, transaction_id, file_content, file_name, file_mime_type } = args;

  // 1. Validar mime type
  if (!ALLOWED_MIME_TYPES.includes(file_mime_type)) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Tipo de arquivo não suportado: ${file_mime_type}. Tipos aceitos: ${ALLOWED_MIME_TYPES.join(', ')}`,
          }),
        },
      ],
    };
  }

  // 2. Decodificar base64
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(file_content, 'base64');
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Conteúdo base64 inválido. Verifique se o arquivo foi codificado corretamente.',
          }),
        },
      ],
    };
  }

  // 3. Validar tamanho
  if (fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (fileBuffer.byteLength / 1024 / 1024).toFixed(2);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Arquivo muito grande: ${sizeMB}MB. Tamanho máximo permitido: 10MB.`,
          }),
        },
      ],
    };
  }

  // 4. Validar acesso à entidade via API Key
  const accessError = await validateEntityAccess(apiKeyHash, entity_id);
  if (accessError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: accessError,
          }),
        },
      ],
    };
  }

  // 5. Verificar que a transação pertence à entidade
  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('id')
    .eq('id', transaction_id)
    .eq('entity_id', entity_id)
    .single();

  if (txError || !transaction) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Lançamento ${transaction_id} não encontrado na entidade ${entity_id}.`,
          }),
        },
      ],
    };
  }

  // 6. Montar path do arquivo
  const ext =
    getExtensionFromFileName(file_name) ?? getMimeExtension(file_mime_type);
  const storagePath = `${entity_id}/${transaction_id}/${Date.now()}.${ext}`;

  // 7. Upload no Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('transaction-attachments')
    .upload(storagePath, fileBuffer, {
      contentType: file_mime_type,
      upsert: true,
    });

  if (uploadError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Falha no upload do arquivo: ${uploadError.message}`,
          }),
        },
      ],
    };
  }

  // 8. Atualizar os campos de anexo na transação
  const { error: updateError } = await supabase
    .from('transactions')
    .update({
      attachment_url: storagePath,
      attachment_name: file_name,
      attachment_type: file_mime_type,
    })
    .eq('id', transaction_id);

  if (updateError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Arquivo salvo no storage mas falha ao vincular ao lançamento: ${updateError.message}. Path do arquivo: ${storagePath}`,
          }),
        },
      ],
    };
  }

  // 9. Retorno de sucesso
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          attachment_url: storagePath,
          attachment_name: file_name,
          attachment_type: file_mime_type,
          message: `Documento "${file_name}" anexado com sucesso ao lançamento.`,
        }),
      },
    ],
  };
}
