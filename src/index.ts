import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

const SHARED_SECRET = process.env.COMPRESSION_SERVICE_SECRET;
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 25 * 1024 * 1024; // Default 25MB

if (!SHARED_SECRET) {
  console.error('FATAL: COMPRESSION_SERVICE_SECRET is not defined');
  process.exit(1);
}

const server = Fastify({ 
  logger: true,
  bodyLimit: MAX_FILE_SIZE + (10 * 1024 * 1024)
});

server.register(multipart);

server.get('/health', async () => {
  return {
    status: 'ok',
    version: process.env.BUILD_ID || 'local',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    maxFileSize: MAX_FILE_SIZE,
    memoryUsage: process.memoryUsage().heapUsed
  };
});

server.get('/check-gs', async (request, reply) => {
  try {
    const { stdout } = await execFileAsync('gs', ['--version']);
    return { ghostscript: stdout.trim(), status: 'installed' };
  } catch (err) {
    return reply.code(500).send({ status: 'missing', error: err });
  }
});

server.post('/compress', async (request, reply) => {
  const signature = request.headers['x-signature'] as string;
  const timestamp = request.headers['x-timestamp'] as string;
  const environment = request.headers['x-environment'] as string || 'production';

  if (!signature || !timestamp) {
    return reply.code(403).send({ error: 'Unauthorized: Missing signature or timestamp' });
  }

  try {
    const hmac = createHmac('sha256', SHARED_SECRET);
    hmac.update(timestamp);
    const expectedSignature = hmac.digest('hex');

    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      server.log.warn({ signature, timestamp }, 'Invalid signature attempt');
      return reply.code(403).send({ error: 'Unauthorized: Invalid signature' });
    }
  } catch (error) {
    server.log.error({ error }, 'Signature validation error');
    return reply.code(403).send({ error: 'Unauthorized: Invalid signature format' });
  }

  const data = await request.file();
  if (!data) {
    return reply.code(400).send({ error: 'No file provided' });
  }

  const fileBuffer = await data.toBuffer();
  if (fileBuffer.length > MAX_FILE_SIZE) {
    server.log.warn({ fileSize: fileBuffer.length, maxSize: MAX_FILE_SIZE }, 'File too large');
    return reply.code(422).send({ 
      error: 'File too large', 
      maxSize: MAX_FILE_SIZE,
      receivedSize: fileBuffer.length 
    });
  }

  if (data.mimetype && !data.mimetype.includes('pdf')) {
    return reply.code(400).send({ error: 'Invalid file type. Only PDF files are supported' });
  }

  const tempId = createHmac('md5', SHARED_SECRET).update(Date.now().toString()).digest('hex');
  const inputPath = path.join(os.tmpdir(), `in_${tempId}.pdf`);
  const outputPath = path.join(os.tmpdir(), `out_${tempId}.pdf`);

  try {
    await fs.writeFile(inputPath, fileBuffer);

      try {
        await execFileAsync('gs', [
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.5',
          '-dPDFSETTINGS=/printer',
          '-dNOPAUSE',
          '-dBATCH',
          '-dQUIET',
          '-dSAFER',
          '-dEmbedAllFonts=true',
          '-dSubsetFonts=false',
          '-dCompressFonts=false',
          '-dConvertCMYKImagesToRGB=false',
          '-dColorImageDownsampleType=/Bicubic',
          '-dColorImageResolution=150',
          '-dGrayImageResolution=150',
          '-dMonoImageResolution=300',
          `-sOutputFile=${outputPath}`,
          inputPath
        ]);
    } catch (gsError: any) {
      server.log.error({ error: gsError, inputPath }, 'Ghostscript execution failed');
      
      await Promise.all([
        fs.unlink(inputPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {})
      ]);

      if (gsError.code === 'ENOENT') {
        return reply.code(500).send({ error: 'Ghostscript not found. Please ensure Ghostscript is installed.' });
      }

      return reply.code(422).send({ 
        error: 'PDF compression failed. The file may be corrupted or invalid.',
        details: gsError.message 
      });
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(outputPath);
    } catch (readError) {
      server.log.error({ error: readError, outputPath }, 'Failed to read compressed file');
      return reply.code(500).send({ error: 'Failed to read compressed file' });
    }
    
    server.log.info({ 
      environment, 
      originalSize: fileBuffer.length, 
      compressedSize: buffer.length,
      compressionRatio: ((1 - buffer.length / fileBuffer.length) * 100).toFixed(2) + '%'
    }, 'Compression successful');

    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);

    return reply.type('application/pdf').send(buffer);
  } catch (error: any) {
    server.log.error({ error, stack: error.stack }, 'Unexpected error during compression');
    
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);

    if (error.code === 'ENOSPC') {
      return reply.code(507).send({ error: 'Insufficient storage space' });
    }

    return reply.code(500).send({ error: 'Internal compression error' });
  }
});

const port = Number(process.env.PORT) || 8080;

function displayBanner() {
  const banner = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║         📄 PDF Compression Service v1.0.0                    ║
║                                                              ║
║         Open-source microservice using Ghostscript           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🚀 Server Configuration:
   • Port: ${port}
   • Max File Size: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB
   • Environment: ${process.env.NODE_ENV || 'development'}

🔒 Security:
   • HMAC-SHA256 signature validation enabled
   • Protection against timing attacks
   • Shell injection protection

📦 Ready to compress PDFs!
   Endpoint: POST http://localhost:${port}/compress

`;
  console.log(banner);
}

async function start() {
  try {
    await server.listen({ port, host: '0.0.0.0' });
    displayBanner();
    server.log.info(`Server listening at http://0.0.0.0:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();

