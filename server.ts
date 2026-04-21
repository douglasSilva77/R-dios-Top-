import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import http from "http";
import https from "https";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Robust Proxy for Radio Streams using Axios
  app.get("/api/proxy", async (req, res) => {
    const streamUrl = req.query.url as string;
    
    if (!streamUrl || streamUrl === 'undefined' || !streamUrl.startsWith('http')) {
      return res.status(400).send("URL de streaming inválida");
    }

    const fetchStream = async (url: string, depth = 0) => {
      if (depth > 5) {
        return res.status(508).send("Muitos redirecionamentos");
      }

      try {
        const response = await axios({
          method: 'get',
          url: url,
          responseType: 'stream',
          timeout: 15000,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RádiosTopApp/1.0',
            'Accept': 'audio/*;q=0.9, */*;q=0.8',
            'Icy-MetaData': '0',
            'Range': 'bytes=0-'
          },
          httpAgent: new http.Agent({ insecureHTTPParser: true } as any),
          httpsAgent: new https.Agent({ insecureHTTPParser: true, rejectUnauthorized: false } as any),
          validateStatus: (status) => status < 400
        });

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        
        // Block non-media types to prevent Open Proxy abuse
        const allowedTypes = ['audio/', 'video/', 'application/ogg', 'application/x-mpegurl', 'application/vnd.apple.mpegurl', 'octet-stream'];
        const isAllowed = allowedTypes.some(type => contentType.includes(type));

        if (contentType.includes('text/html') && !url.includes(';')) {
          const suffixUrl = url.endsWith('/') ? url + ';' : url + '/;';
          return fetchStream(suffixUrl, depth + 1);
        }

        if (!isAllowed && !contentType.includes('text/html')) {
          console.warn(`[PROXY] Bloqueado Content-Type suspeito: ${contentType}`);
          // We still try to stream if it looks like an audio port, but Google likes strict types
        }

        res.setHeader('Content-Type', contentType || 'audio/mpeg');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff'); // Security header

        response.data.pipe(res);

        req.on('close', () => {
          if (response.data) response.data.destroy();
        });

      } catch (error: any) {
        if (!res.headersSent) {
          res.status(500).send("Erro no Proxy");
        }
      }
    };

    fetchStream(streamUrl);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
