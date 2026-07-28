import { getStore } from '@netlify/blobs';
const CHUNK_STORE_NAME = 'video-chunks';
const FINAL_STORE_NAME = 'creative-videos';
const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
    try {
        // Parsear el body
        let body;
        try {
            if (event.isBase64Encoded && event.body) {
                const decoded = Buffer.from(event.body, 'base64').toString('utf-8');
                body = JSON.parse(decoded);
            }
            else {
                body = JSON.parse(event.body || '{}');
            }
        }
        catch {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid request body' }),
            };
        }
        const { uploadId, chunkNumber, totalChunks, chunk, filename, contentType } = body;
        // Validaciones básicas
        if (!uploadId || chunkNumber === undefined || !totalChunks || !chunk) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: uploadId, chunkNumber, totalChunks, chunk' }),
            };
        }
        if (chunkNumber < 0 || chunkNumber >= totalChunks) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid chunkNumber: must be between 0 and totalChunks-1' }),
            };
        }
        // Guardar el chunk en el store temporal
        const chunkStore = getStore(CHUNK_STORE_NAME);
        const chunkKey = `chunks/${uploadId}/${chunkNumber}`;
        const chunkBuffer = Buffer.from(chunk, 'base64');
        // Convertir a Uint8Array para compatibilidad con el tipo BlobInput
        await chunkStore.set(chunkKey, new Uint8Array(chunkBuffer), {
            contentType: 'application/octet-stream',
        });
        console.log(`Chunk ${chunkNumber + 1}/${totalChunks} guardado para upload ${uploadId}`);
        // Si no es el último chunk, confirmar recepción
        const isLastChunk = chunkNumber === totalChunks - 1;
        if (!isLastChunk) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `Chunk ${chunkNumber + 1}/${totalChunks} recibido`,
                    received: true,
                }),
            };
        }
        // === ES EL ÚLTIMO CHUNK: Reensamblar todo ===
        console.log(`Iniciando reensamble de ${totalChunks} chunks para upload ${uploadId}`);
        // Recoger todos los chunks en orden
        const chunks = [];
        for (let i = 0; i < totalChunks; i++) {
            const key = `chunks/${uploadId}/${i}`;
            try {
                const chunkData = await chunkStore.get(key);
                if (!chunkData) {
                    throw new Error(`Chunk ${i} no encontrado`);
                }
                chunks.push(Buffer.from(chunkData));
                console.log(`Chunk ${i + 1}/${totalChunks} leído`);
            }
            catch (err) {
                console.error(`Error leyendo chunk ${i}:`, err);
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        error: 'CHUNK_MISSING',
                        message: `Falta el chunk ${i}. La subida se canceló. Intenta de nuevo.`,
                        missingChunk: i,
                    }),
                };
            }
        }
        // Combinar todos los chunks
        const finalBuffer = Buffer.concat(chunks);
        console.log(`Video reensamblado: ${finalBuffer.length} bytes`);
        // Guardar el video final
        const finalStore = getStore(FINAL_STORE_NAME);
        const finalKey = `creative-videos/${uploadId}.mp4`;
        await finalStore.set(finalKey, new Uint8Array(finalBuffer), {
            contentType: contentType || 'video/mp4',
        });
        console.log(`Video final guardado en ${finalKey}`);
        // Limpiar chunks temporales (sin await para no bloquear)
        cleanupChunks(uploadId, totalChunks, chunkStore).catch(err => {
            console.error('Error limpiando chunks:', err);
        });
        // Generar URL
        const videoUrl = `/.netlify/functions/get-video?key=${encodeURIComponent(finalKey)}`;
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                videoUrl,
                key: finalKey,
                message: 'Video completo subido y reensamblado',
                fileSize: finalBuffer.length,
            }),
        };
    }
    catch (err) {
        console.error('Upload chunk error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process chunk', detail: String(err) }),
        };
    }
};
/**
 * Limpia los chunks temporales después de un upload exitoso
 */
async function cleanupChunks(uploadId, totalChunks, store) {
    console.log(`Limpiando ${totalChunks} chunks para upload ${uploadId}`);
    const errors = [];
    for (let i = 0; i < totalChunks; i++) {
        const key = `chunks/${uploadId}/${i}`;
        try {
            await store.delete(key);
        }
        catch (err) {
            errors.push(`No se pudo eliminar chunk ${i}: ${err}`);
        }
    }
    if (errors.length > 0) {
        console.warn('Errores en limpieza de chunks:', errors);
    }
    else {
        console.log(`Chunks limpiados exitosamente para upload ${uploadId}`);
    }
}
export { handler };
