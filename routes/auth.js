const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticateToken, requireRole, generateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);

    // Get user's client orgs
    const clientOrgs = db.prepare(`
      SELECT co.* FROM client_orgs co
      JOIN user_client_orgs uco ON co.id = uco.client_org_id
      WHERE uco.user_id = ?
    `).all(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_color: user.avatar_color,
        client_orgs: clientOrgs
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const db = getDb();
  const clientOrgs = db.prepare(`
    SELECT co.* FROM client_orgs co
    JOIN user_client_orgs uco ON co.id = uco.client_org_id
    WHERE uco.user_id = ?
  `).all(req.user.id);

  res.json({
    ...req.user,
    client_orgs: clientOrgs
  });
});

// POST /api/auth/register (Super Admin only)
router.post('/register', authenticateToken, requireRole('super_admin'), (req, res) => {
  try {
    const { email, password, name, role, client_org_ids } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (!['super_admin', 'manager', 'client'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#06B6D4'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    db.prepare(`
      INSERT INTO users (id, email, password, name, role, avatar_color)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase(), hashedPassword, name, role, avatarColor);

    // Link to client orgs if provided
    if (client_org_ids && client_org_ids.length > 0) {
      const insertOrg = db.prepare('INSERT OR IGNORE INTO user_client_orgs (user_id, client_org_id) VALUES (?, ?)');
      for (const orgId of client_org_ids) {
        insertOrg.run(id, orgId);
      }
    }

    res.status(201).json({
      id,
      email: email.toLowerCase(),
      name,
      role,
      avatar_color: avatarColor
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/users (Admin/Manager)
router.get('/users', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT id, email, name, role, avatar_color, created_at FROM users ORDER BY created_at DESC
    `).all();

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/client-orgs (Super Admin)
router.post('/client-orgs', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const { name, logo_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const db = getDb();
    const id = uuidv4();
    db.prepare('INSERT INTO client_orgs (id, name, logo_url) VALUES (?, ?, ?)').run(id, name, logo_url || null);

    res.status(201).json({ id, name, logo_url });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/client-orgs
router.get('/client-orgs', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    let orgs;
    if (req.user.role === 'super_admin' || req.user.role === 'manager') {
      orgs = db.prepare('SELECT * FROM client_orgs ORDER BY name').all();
    } else {
      orgs = db.prepare(`
        SELECT co.* FROM client_orgs co
        JOIN user_client_orgs uco ON co.id = uco.client_org_id
        WHERE uco.user_id = ?
        ORDER BY co.name
      `).all(req.user.id);
    }
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
