const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'sm-dashboard-secret-key-change-in-production';

// Verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const user = db.prepare('SELECT id, email, name, role, avatar_color FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Role-based authorization
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Check if user has access to a specific client org
function requireClientAccess(req, res, next) {
  if (req.user.role === 'super_admin') {
    return next(); // Super admins access everything
  }

  const clientOrgId = req.params.clientOrgId || req.body.client_org_id || req.query.client_org_id;

  if (!clientOrgId) {
    return next(); // No specific client context
  }

  const db = getDb();
  const access = db.prepare(
    'SELECT 1 FROM user_client_orgs WHERE user_id = ? AND client_org_id = ?'
  ).get(req.user.id, clientOrgId);

  if (!access) {
    return res.status(403).json({ error: 'No access to this client organization' });
  }

  next();
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = {
  authenticateToken,
  requireRole,
  requireClientAccess,
  generateToken,
  JWT_SECRET
};
