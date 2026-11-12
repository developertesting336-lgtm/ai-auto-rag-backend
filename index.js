import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { testConnection } from './src/config/db.js';
import { initDb } from './src/db/initDb.js';
import { serveChatbotWidget } from './src/controllers/embedController.js';
import apiRoutes from './src/routes/index.js';

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS
app.use(cors());

// Body parsing middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Root welcome route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'AI Automation SaaS Backend API',
    endpoints: {
      health: '/api/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        profile: 'PUT /api/auth/profile',
        changePassword: 'PUT /api/auth/change-password',
      },
      users: '/api/users',
      apiKeys: '/api/api-keys',
      ai: '/api/ai/generate',
    },
  });
});

// Database Health Check route
app.get('/api/health', async (req, res) => {
  const dbStatus = await testConnection();
  const statusCode = dbStatus.success ? 200 : 503;
  res.status(statusCode).json({
    status: dbStatus.success ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
});

// Embeddable Chatbot Widget Routes (Public static JS for client websites)
app.get('/embed/chatbot.js', serveChatbotWidget);
app.get('/embed/chat.js', serveChatbotWidget);

// API Routes
app.use('/api', apiRoutes);

// 404 Not Forwarded / Not Found Middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Central Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);

  // PostgreSQL Unique Constraint Violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: 'A record with that unique field already exists.',
      detail: err.detail,
    });
  }

  // PostgreSQL Foreign Key Violation
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: 'Foreign key constraint violated.',
      detail: err.detail,
    });
  }

  // Database Connection Error
  if (err.code === 'ECONNREFUSED' || err.message?.includes('Database pool is not initialized')) {
    return res.status(503).json({
      success: false,
      error: 'Database connection unavailable. Please check your PostgreSQL server and .env settings.',
      message: err.message,
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

// Start Server and verify DB connection (Skipped in Vercel Serverless environment)
let server = null;

if (!process.env.VERCEL) {
  server = app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`===============================================`);

    // Run database connection check
    const dbHealth = await testConnection();
    if (dbHealth.success) {
      console.log(`✅ Aiven PostgreSQL: ${dbHealth.message}`);
      // Auto-create tables (users, api_keys) if they don't exist yet
      try {
        await initDb();
      } catch (schemaErr) {
        console.warn(`⚠️ Schema auto-init warning:`, schemaErr.message);
      }
    } else {
      console.warn(`⚠️ PostgreSQL Connection: ${dbHealth.message}`);
      console.warn(`👉 Check your Aiven PostgreSQL credentials in backend/.env`);
    }
  });
}

export { app, server };
export default app;
