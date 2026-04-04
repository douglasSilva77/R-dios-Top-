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
    
    if (!streamUrl || streamUrl === 'undefined') {
      return res.status(400).send("URL de streaming inválida");
    }

    const fetchStream = async (url: string, depth = 0) => {
      if (depth > 5) {
        return res.status(508).send("Muitos redirecionamentos");
      }

      console.log(`[PROXY] [D:${depth}] Solicitando: ${url}`);

      try {
        const response = await axios({
          method: 'get',
          url: url,
          responseType: 'stream',
          timeout: 20000,
          maxRedirects: 10,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Icy-MetaData': '0',
            'Connection': 'close'
          },
          // Use custom agents to handle non-standard radio headers (ICY)
          httpAgent: new http.Agent({ insecureHTTPParser: true } as any),
          httpsAgent: new https.Agent({ insecureHTTPParser: true, rejectUnauthorized: false } as any),
          validateStatus: (status) => status < 400
        });

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        
        // Shoutcast/Icecast status page detection
        if (contentType.includes('text/html') && depth === 0) {
          console.log(`[PROXY] Recebeu HTML, tentando sufixo de stream Shoutcast...`);
          const suffixUrl = url.endsWith('/') ? url + ';' : url + '/;';
          return fetchStream(suffixUrl, depth + 1);
        }

        // Forward headers
        res.setHeader('Content-Type', contentType || 'audio/mpeg');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        console.log(`[PROXY] Transmitindo: ${url} | Type: ${contentType}`);

        response.data.pipe(res);

        // Cleanup on disconnect
        req.on('close', () => {
          if (response.data) response.data.destroy();
        });

        response.data.on('error', (err: any) => {
          console.error('[PROXY] Erro no stream:', err.message);
          res.end();
        });

      } catch (error: any) {
        console.error(`[PROXY] Erro ao acessar ${url}:`, error.message);
        if (!res.headersSent) {
          const status = error.response?.status || 500;
          res.status(status).send(`Erro no Proxy: ${error.message}`);
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
