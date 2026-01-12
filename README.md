# PDF Compression Service

Open-source microservice for PDF compression using Ghostscript. Created to comply with AGPL license and isolate Ghostscript in a separate open-source service.

## Features

- 🔒 Secure authorization via HMAC signature
- 📦 PDF compression using Ghostscript
- 🐳 Ready Docker image for deployment
- ⚡ Fast and lightweight microservice on Fastify
- 🔐 Protection against shell injection and timing attacks

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```bash
COMPRESSION_SERVICE_SECRET=your-secret-key-here
PORT=8880  # For local development (to avoid conflicts with other services on 8080)
MAX_FILE_SIZE=26214400  # Maximum file size in bytes (default: 25MB)
```

To generate a secure secret key:
```bash
openssl rand -hex 32
```

## Development

```bash
# Development with auto-reload
npm run dev

# Build project
npm run build

# Run built project
npm start
```

## Docker

```bash
# Build image
docker build -t pdf-compression-service .

# Run container
docker run -p 8080:8080 -e COMPRESSION_SERVICE_SECRET=your-secret-key pdf-compression-service
```

## API

### POST /compress

Compress PDF file.

**Headers:**
- `x-signature` - HMAC-SHA256 signature (required)
- `x-timestamp` - Timestamp for signature (required)
- `x-environment` - Environment (optional, defaults to 'production')

**Body:** multipart/form-data with PDF file

**Response codes:**
- `200` - Success, returns compressed PDF
- `400` - Bad request (no file provided, invalid file type)
- `403` - Unauthorized (missing or invalid signature)
- `422` - Unprocessable entity (file too large, compression failed, invalid PDF)
- `500` - Internal server error
- `507` - Insufficient storage space

**Usage example:**

```javascript
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');

const secret = 'your-secret-key';
const timestamp = Date.now().toString();
const hmac = crypto.createHmac('sha256', secret);
hmac.update(timestamp);
const signature = hmac.digest('hex');

const form = new FormData();
form.append('file', fs.createReadStream('input.pdf'));

fetch('http://localhost:8880/compress', {
  method: 'POST',
  headers: {
    'x-signature': signature,
    'x-timestamp': timestamp,
    'x-environment': 'production',
    ...form.getHeaders()
  },
  body: form
})
.then(res => res.buffer())
.then(buffer => fs.writeFileSync('output.pdf', buffer));
```

## Azure Deployment

Service is ready for deployment on Azure App Service or Azure Container Apps. Make sure:
- Environment variable `COMPRESSION_SERVICE_SECRET` is set
- Environment variable `MAX_FILE_SIZE` is set (optional, defaults to 25MB)
- Port is configured to 8080 (default)

## License

AGPL-3.0 (to comply with Ghostscript license)
