import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import http from 'http';
import https from 'https';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const streamUrl = req.query.url as string;

  if (!streamUrl || streamUrl === 'undefined') {
    return res.status(400).send("URL de streaming inválida");
  }

  const fetchStream = async (url: string, depth = 0): Promise<any> => {
    if (depth > 5) {
      return res.status(508).send("Muitos redirecionamentos");
    }

    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 25000,
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Icy-MetaData': '0',
          'Connection': 'close'
        },
        httpAgent: new http.Agent({ insecureHTTPParser: true } as any),
        httpsAgent: new https.Agent({ insecureHTTPParser: true, rejectUnauthorized: false } as any),
        validateStatus: (status) => status < 400
      });

      const contentType = (response.headers['content-type'] || '').toLowerCase();
      
      // Shoutcast/Icecast status page detection
      if (contentType.includes('text/html') && depth === 0) {
        const suffixUrl = url.endsWith('/') ? url + ';' : url + '/;';
        return fetchStream(suffixUrl, depth + 1);
      }

      res.setHeader('Content-Type', contentType || 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      response.data.pipe(res);

      req.on('close', () => {
        if (response.data) response.data.destroy();
      });

    } catch (error: any) {
      console.error(`[PROXY ERROR] ${url}:`, error.message);
      if (!res.headersSent) {
        res.status(500).send(`Erro no Proxy: ${error.message}`);
      }
    }
  };

  await fetchStream(streamUrl);
}
