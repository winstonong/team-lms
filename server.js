const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const emailLib = require('./email');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lms-secret-key-change-in-production';
const COOKIE_NAME = 'token';
const SALT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Ensure data directory exists
//
// IMPORTANT: In production (Railway), DATA_DIR should point to a mounted
// volume (e.g. /data) so the SQLite file survives container redeploys.
// Set DATA_DIR=/data in Railway env vars and attach a Volume mounted at /data.
// Locally we fall back to ./data.
// ---------------------------------------------------------------------------
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = path.join(dataDir, 'lms.db');
console.log(`[db] Using SQLite file at ${DB_PATH}`);

// ---------------------------------------------------------------------------
// sql.js wrapper — provides a better-sqlite3-like synchronous interface
// ---------------------------------------------------------------------------
let db;

function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Auto-save every 5 seconds if changes occurred
let dbDirty = false;
setInterval(() => {
  if (dbDirty && db) {
    saveDatabase();
    dbDirty = false;
  }
}, 5000);

// Wrapper that marks DB as dirty on write operations
function dbRun(sql, params = []) {
  db.run(sql, params);
  dbDirty = true;
  return { lastInsertRowid: db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] };
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    row = {};
    cols.forEach((c, i) => { row[c] = vals[i]; });
  }
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  const cols = stmt.getColumnNames();
  while (stmt.step()) {
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => { row[c] = vals[i]; });
    rows.push(row);
  }
  stmt.free();
  return rows;
}

// ---------------------------------------------------------------------------
// Database schema
// ---------------------------------------------------------------------------
function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'learner' CHECK(role IN ('admin','instructor','learner')),
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      thumbnail_url TEXT,
      instructor_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT,
      difficulty TEXT DEFAULT 'beginner' CHECK(difficulty IN ('beginner','intermediate','advanced')),
      is_published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      order_num INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      passing_score INTEGER NOT NULL DEFAULT 70
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'multiple_choice' CHECK(question_type IN ('multiple_choice','true_false')),
      options TEXT,
      correct_answer TEXT NOT NULL,
      order_num INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      UNIQUE(user_id, course_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS lesson_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      UNIQUE(user_id, lesson_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      answers TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      certificate_code TEXT UNIQUE NOT NULL,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, course_id)
    )
  `);
  dbDirty = true;
}

function seedAdmin() {
  const existing = dbGet('SELECT id, role FROM users WHERE email = ?', ['admin@team.com']);
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', SALT_ROUNDS);
    dbRun('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)', ['admin@team.com', 'Admin', hash, 'admin']);
    console.log('Seeded admin user: admin@team.com / admin123');
  } else if (existing.role !== 'admin') {
    // Self-heal: ensure the seeded admin email always has admin role
    dbRun("UPDATE users SET role = 'admin' WHERE email = ?", ['admin@team.com']);
    console.log('Restored admin@team.com to admin role');
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth helpers & middleware
// ---------------------------------------------------------------------------
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = dbGet('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = sanitizeUser(user);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return [requireAuth, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  }];
}

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'Email, name and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const result = dbRun('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)', [email, name, hash, 'learner']);

    const user = dbGet('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

    // Fire welcome email (non-blocking — never fail registration on email issues)
    if (emailLib.isConfigured()) {
      emailLib.sendWelcome({ to: user.email, name: user.name })
        .catch(err => console.error('[email] welcome failed:', err.message));
    }

    res.status(201).json({ user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// PASSWORD RESET
// ---------------------------------------------------------------------------
// Always responds 200 regardless of whether the email exists, so attackers
// can't enumerate accounts. The actual reset link is delivered via email.
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      dbRun(
        'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)',
        [token, user.id, expires]
      );

      if (emailLib.isConfigured()) {
        const result = await emailLib.sendPasswordReset({
          to: user.email, name: user.name, token
        });
        if (!result.ok) console.error('[forgot-password] send failed:', result.error);
      } else {
        console.warn(`[forgot-password] Email not configured. Manual reset URL: /#/reset-password/${token}`);
      }
    }

    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const row = dbGet('SELECT * FROM password_reset_tokens WHERE token = ?', [token]);
    if (!row || row.used) return res.status(400).json({ error: 'Invalid or already-used reset link' });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    dbRun('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [token]);

    res.json({ message: 'Password updated. You can sign in now.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------------
// USER ROUTES (admin only)
// ---------------------------------------------------------------------------
app.get('/api/users', ...requireRole('admin'), (req, res) => {
  try {
    const users = dbAll('SELECT id, email, name, role, avatar_url, created_at FROM users ORDER BY created_at DESC');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/role', ...requireRole('admin'), (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'instructor', 'learner'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const userId = parseInt(req.params.id);
    const user = dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    dbRun('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    const updated = dbGet('SELECT id, email, name, role, avatar_url, created_at FROM users WHERE id = ?', [userId]);
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// COURSE ROUTES
// ---------------------------------------------------------------------------

// Helpers
function withStatus(course) {
  if (!course) return course;
  return { ...course, status: course.is_published ? 'published' : 'draft' };
}

function saveCourseLessons(courseId, lessons) {
  if (!Array.isArray(lessons)) return { skipped: 0 };

  // Validate up-front so we can return a clear error
  const blank = lessons
    .map((l, i) => ({ i, title: (l && l.title || '').trim() }))
    .filter(x => !x.title);
  if (blank.length) {
    const indexes = blank.map(b => b.i + 1).join(', ');
    const err = new Error(`Lesson ${indexes} is missing a title. Please name every lesson before saving.`);
    err.statusCode = 400;
    throw err;
  }

  const existing = dbAll('SELECT id FROM lessons WHERE course_id = ?', [courseId]);
  const incomingIds = new Set(lessons.filter(l => l && l.id).map(l => l.id));

  // Delete lessons no longer present
  for (const row of existing) {
    if (!incomingIds.has(row.id)) {
      dbRun('DELETE FROM lessons WHERE id = ?', [row.id]);
    }
  }

  let saved = 0;

  // Upsert lessons in order
  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i] || {};
    const title = (l.title || '').trim();
    if (!title) continue; // already validated above, defensive

    const content = l.content || '';
    const duration = parseInt(l.duration ?? l.duration_minutes) || 0;
    const orderNum = i;

    let lessonId;
    if (l.id && existing.some(r => r.id === l.id)) {
      dbRun(
        'UPDATE lessons SET title = ?, content = ?, order_num = ?, duration_minutes = ? WHERE id = ?',
        [title, content, orderNum, duration, l.id]
      );
      lessonId = l.id;
    } else {
      const result = dbRun(
        'INSERT INTO lessons (course_id, title, content, order_num, duration_minutes) VALUES (?, ?, ?, ?, ?)',
        [courseId, title, content, orderNum, duration]
      );
      lessonId = result.lastInsertRowid;
    }
    saved++;

    // Handle quiz upsert
    const quiz = l.quiz;
    const existingQuiz = dbGet('SELECT * FROM quizzes WHERE lesson_id = ?', [lessonId]);
    if (quiz && Array.isArray(quiz.questions) && quiz.questions.length > 0) {
      let quizId;
      if (existingQuiz) {
        dbRun('UPDATE quizzes SET title = ?, passing_score = ? WHERE id = ?', [
          quiz.title || `${title} Quiz`,
          quiz.passingScore ?? quiz.passing_score ?? 70,
          existingQuiz.id
        ]);
        dbRun('DELETE FROM quiz_questions WHERE quiz_id = ?', [existingQuiz.id]);
        quizId = existingQuiz.id;
      } else {
        const r = dbRun('INSERT INTO quizzes (lesson_id, title, passing_score) VALUES (?, ?, ?)', [
          lessonId,
          quiz.title || `${title} Quiz`,
          quiz.passingScore ?? quiz.passing_score ?? 70
        ]);
        quizId = r.lastInsertRowid;
      }
      for (let qi = 0; qi < quiz.questions.length; qi++) {
        const q = quiz.questions[qi];
        const questionText = q.question_text || q.question || '';
        if (!questionText.trim()) continue;
        dbRun(
          'INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, order_num) VALUES (?, ?, ?, ?, ?, ?)',
          [
            quizId,
            questionText,
            q.question_type || 'multiple_choice',
            JSON.stringify(q.options || []),
            String(q.correct_answer ?? q.correctAnswer ?? 0),
            qi
          ]
        );
      }
    } else if (existingQuiz) {
      // Quiz removed
      dbRun('DELETE FROM quizzes WHERE id = ?', [existingQuiz.id]);
    }
  }

  return { saved };
}

app.get('/api/courses', requireAuth, (req, res) => {
  try {
    let courses;
    if (req.user.role === 'admin' || req.user.role === 'instructor') {
      courses = dbAll(`
        SELECT c.*, u.name as instructor_name,
          (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
          (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as enrollment_count
        FROM courses c
        JOIN users u ON c.instructor_id = u.id
        ORDER BY c.updated_at DESC
      `);
    } else {
      courses = dbAll(`
        SELECT c.*, u.name as instructor_name,
          (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
          (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as enrollment_count
        FROM courses c
        JOIN users u ON c.instructor_id = u.id
        WHERE c.is_published = 1
        ORDER BY c.updated_at DESC
      `);
    }
    res.json({ courses: courses.map(withStatus) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/:id', requireAuth, (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const course = dbGet(`
      SELECT c.*, u.name as instructor_name
      FROM courses c
      JOIN users u ON c.instructor_id = u.id
      WHERE c.id = ?
    `, [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    if (!course.is_published && req.user.role === 'learner' && course.instructor_id !== req.user.id) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const lessons = dbAll('SELECT * FROM lessons WHERE course_id = ? ORDER BY order_num ASC', [courseId]);
    const enrollment = dbGet('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);

    res.json({ course: withStatus(course), lessons, enrolled: !!enrollment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const { title, description, thumbnail_url, category, difficulty, status, lessons } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const isPublished = status === 'published' ? 1 : 0;

    const result = dbRun(`
      INSERT INTO courses (title, description, thumbnail_url, instructor_id, category, difficulty, is_published)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [title, description || '', thumbnail_url || '', req.user.id, category || '', difficulty || 'beginner', isPublished]);

    const courseId = result.lastInsertRowid;
    saveCourseLessons(courseId, lessons);

    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    res.status(201).json({ course: withStatus(course) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/courses/:id', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this course' });
    }

    const { title, description, thumbnail_url, category, difficulty, status, lessons } = req.body;
    const isPublished = status === undefined
      ? course.is_published
      : (status === 'published' ? 1 : 0);

    dbRun(`
      UPDATE courses SET title = ?, description = ?, thumbnail_url = ?, category = ?, difficulty = ?, is_published = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [
      title ?? course.title,
      description ?? course.description,
      thumbnail_url ?? course.thumbnail_url,
      category ?? course.category,
      difficulty ?? course.difficulty,
      isPublished,
      courseId
    ]);

    if (lessons !== undefined) saveCourseLessons(courseId, lessons);

    const updated = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    res.json({ course: withStatus(updated) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/courses/:id', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this course' });
    }

    dbRun('DELETE FROM courses WHERE id = ?', [courseId]);
    res.json({ message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses/:id/publish', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const newState = course.is_published ? 0 : 1;
    dbRun("UPDATE courses SET is_published = ?, updated_at = datetime('now') WHERE id = ?", [newState, courseId]);
    const updated = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    res.json({ course: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// LESSON ROUTES
// ---------------------------------------------------------------------------
app.get('/api/courses/:courseId/lessons', requireAuth, (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const lessons = dbAll('SELECT * FROM lessons WHERE course_id = ? ORDER BY order_num ASC', [courseId]);
    res.json({ lessons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/:courseId/lessons/:id', requireAuth, (req, res) => {
  try {
    const lessonId = parseInt(req.params.id);
    const courseId = parseInt(req.params.courseId);
    const lesson = dbGet('SELECT * FROM lessons WHERE id = ? AND course_id = ?', [lessonId, courseId]);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const quiz = dbGet('SELECT * FROM quizzes WHERE lesson_id = ?', [lessonId]);
    let questions = [];
    if (quiz) {
      questions = dbAll('SELECT id, quiz_id, question_text, question_type, options, order_num FROM quiz_questions WHERE quiz_id = ? ORDER BY order_num ASC', [quiz.id]);
      questions = questions.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));
    }

    const progress = dbGet('SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', [req.user.id, lessonId]);

    res.json({ lesson, quiz, questions, completed: !!(progress && progress.completed) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses/:courseId/lessons', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { title, content, order_num, duration_minutes } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const maxOrder = dbGet('SELECT MAX(order_num) as max_order FROM lessons WHERE course_id = ?', [courseId]);
    const orderVal = order_num ?? ((maxOrder && maxOrder.max_order != null ? maxOrder.max_order : -1) + 1);

    const result = dbRun('INSERT INTO lessons (course_id, title, content, order_num, duration_minutes) VALUES (?, ?, ?, ?, ?)', [
      courseId, title, content || '', orderVal, duration_minutes || 0
    ]);

    dbRun("UPDATE courses SET updated_at = datetime('now') WHERE id = ?", [courseId]);
    const lesson = dbGet('SELECT * FROM lessons WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ lesson });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/courses/:courseId/lessons/:id', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const lessonId = parseInt(req.params.id);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const lesson = dbGet('SELECT * FROM lessons WHERE id = ? AND course_id = ?', [lessonId, courseId]);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const { title, content, order_num, duration_minutes } = req.body;
    dbRun('UPDATE lessons SET title = ?, content = ?, order_num = ?, duration_minutes = ? WHERE id = ?', [
      title ?? lesson.title,
      content ?? lesson.content,
      order_num ?? lesson.order_num,
      duration_minutes ?? lesson.duration_minutes,
      lessonId
    ]);

    dbRun("UPDATE courses SET updated_at = datetime('now') WHERE id = ?", [courseId]);
    const updated = dbGet('SELECT * FROM lessons WHERE id = ?', [lessonId]);
    res.json({ lesson: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/courses/:courseId/lessons/:id', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const lessonId = parseInt(req.params.id);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const lesson = dbGet('SELECT * FROM lessons WHERE id = ? AND course_id = ?', [lessonId, courseId]);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    dbRun('DELETE FROM lessons WHERE id = ?', [lessonId]);
    dbRun("UPDATE courses SET updated_at = datetime('now') WHERE id = ?", [courseId]);
    res.json({ message: 'Lesson deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses/:courseId/lessons/:id/complete', requireAuth, (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const lessonId = parseInt(req.params.id);

    const enrollment = dbGet('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled in this course' });

    const lesson = dbGet('SELECT * FROM lessons WHERE id = ? AND course_id = ?', [lessonId, courseId]);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    // Upsert progress
    const existing = dbGet('SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', [req.user.id, lessonId]);
    if (existing) {
      dbRun("UPDATE lesson_progress SET completed = 1, completed_at = datetime('now') WHERE user_id = ? AND lesson_id = ?", [req.user.id, lessonId]);
    } else {
      dbRun("INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed, completed_at) VALUES (?, ?, ?, 1, datetime('now'))", [req.user.id, lessonId, courseId]);
    }

    // Check if all lessons complete -> mark course complete
    const totalLessons = dbGet('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?', [courseId]).count;
    const completedLessons = dbGet('SELECT COUNT(*) as count FROM lesson_progress WHERE user_id = ? AND course_id = ? AND completed = 1', [req.user.id, courseId]).count;

    if (totalLessons > 0 && completedLessons >= totalLessons) {
      dbRun("UPDATE enrollments SET completed_at = datetime('now') WHERE user_id = ? AND course_id = ? AND completed_at IS NULL", [req.user.id, courseId]);
    }

    res.json({ completed: true, progress: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// QUIZ ROUTES
// ---------------------------------------------------------------------------
app.get('/api/lessons/:lessonId/quiz', requireAuth, (req, res) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    const quiz = dbGet('SELECT * FROM quizzes WHERE lesson_id = ?', [lessonId]);
    if (!quiz) return res.status(404).json({ error: 'No quiz for this lesson' });

    let questions = dbAll('SELECT id, quiz_id, question_text, question_type, options, order_num FROM quiz_questions WHERE quiz_id = ? ORDER BY order_num ASC', [quiz.id]);
    questions = questions.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));

    const attempts = dbAll('SELECT id, score, passed, attempted_at FROM quiz_attempts WHERE user_id = ? AND quiz_id = ? ORDER BY attempted_at DESC', [req.user.id, quiz.id]);

    res.json({ quiz, questions, attempts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lessons/:lessonId/quiz', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    const lesson = dbGet('SELECT * FROM lessons WHERE id = ?', [lessonId]);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const course = dbGet('SELECT * FROM courses WHERE id = ?', [lesson.course_id]);
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { title, passing_score, questions } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    // Upsert quiz
    let quiz = dbGet('SELECT * FROM quizzes WHERE lesson_id = ?', [lessonId]);
    let quizId;
    if (quiz) {
      dbRun('UPDATE quizzes SET title = ?, passing_score = ? WHERE id = ?', [title, passing_score ?? 70, quiz.id]);
      dbRun('DELETE FROM quiz_questions WHERE quiz_id = ?', [quiz.id]);
      quizId = quiz.id;
    } else {
      const result = dbRun('INSERT INTO quizzes (lesson_id, title, passing_score) VALUES (?, ?, ?)', [lessonId, title, passing_score ?? 70]);
      quizId = result.lastInsertRowid;
    }

    // Insert questions
    if (questions && Array.isArray(questions)) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        dbRun('INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, order_num) VALUES (?, ?, ?, ?, ?, ?)', [
          quizId,
          q.question_text,
          q.question_type || 'multiple_choice',
          JSON.stringify(q.options || []),
          q.correct_answer,
          q.order_num ?? i
        ]);
      }
    }

    const updatedQuiz = dbGet('SELECT * FROM quizzes WHERE id = ?', [quizId]);
    const updatedQuestions = dbAll('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_num', [quizId]);
    res.json({ quiz: updatedQuiz, questions: updatedQuestions.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quizzes/:quizId/submit', requireAuth, (req, res) => {
  try {
    const quizId = parseInt(req.params.quizId);
    const quiz = dbGet('SELECT * FROM quizzes WHERE id = ?', [quizId]);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Answers required' });

    const questions = dbAll('SELECT * FROM quiz_questions WHERE quiz_id = ?', [quizId]);
    if (questions.length === 0) return res.status(400).json({ error: 'Quiz has no questions' });

    let correct = 0;
    const results = [];
    for (const q of questions) {
      const userAnswer = answers[q.id] ?? answers[String(q.id)];
      const isCorrect = userAnswer !== undefined && String(userAnswer).toLowerCase().trim() === String(q.correct_answer).toLowerCase().trim();
      if (isCorrect) correct++;
      results.push({ question_id: q.id, user_answer: userAnswer, correct_answer: q.correct_answer, is_correct: isCorrect });
    }

    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= quiz.passing_score ? 1 : 0;

    dbRun('INSERT INTO quiz_attempts (user_id, quiz_id, score, passed, answers) VALUES (?, ?, ?, ?, ?)', [
      req.user.id, quizId, score, passed, JSON.stringify(results)
    ]);

    res.json({ score, passed: !!passed, total: questions.length, correct, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ENROLLMENT ROUTES
// ---------------------------------------------------------------------------
app.post('/api/courses/:id/enroll', requireAuth, (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const course = dbGet('SELECT * FROM courses WHERE id = ? AND is_published = 1', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found or not published' });

    const existing = dbGet('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    if (existing) return res.status(409).json({ error: 'Already enrolled' });

    dbRun('INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)', [req.user.id, courseId]);
    res.status(201).json({ message: 'Enrolled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/my/enrollments', requireAuth, (req, res) => {
  try {
    const enrollments = dbAll(`
      SELECT e.*, c.title, c.description, c.thumbnail_url, c.category, c.difficulty, u.name as instructor_name,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as total_lessons,
        (SELECT COUNT(*) FROM lesson_progress WHERE user_id = e.user_id AND course_id = c.id AND completed = 1) as completed_lessons
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users u ON c.instructor_id = u.id
      WHERE e.user_id = ?
      ORDER BY e.enrolled_at DESC
    `, [req.user.id]);

    const result = enrollments.map(e => ({
      ...e,
      progress: e.total_lessons > 0 ? Math.round((e.completed_lessons / e.total_lessons) * 100) : 0
    }));

    res.json({ enrollments: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/:id/progress', requireAuth, (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const enrollment = dbGet('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    const lessons = dbAll('SELECT * FROM lessons WHERE course_id = ? ORDER BY order_num ASC', [courseId]);
    const progressRows = dbAll('SELECT * FROM lesson_progress WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    const progressMap = new Map(progressRows.map(p => [p.lesson_id, p]));

    const lessonProgress = lessons.map(l => ({
      lesson_id: l.id,
      title: l.title,
      order_num: l.order_num,
      completed: progressMap.has(l.id) ? !!progressMap.get(l.id).completed : false,
      completed_at: progressMap.has(l.id) ? progressMap.get(l.id).completed_at : null
    }));

    const completedCount = progressRows.filter(p => p.completed).length;
    const overallProgress = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;

    res.json({
      course_id: courseId,
      enrolled_at: enrollment.enrolled_at,
      completed_at: enrollment.completed_at,
      overall_progress: overallProgress,
      lessons: lessonProgress
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CERTIFICATE ROUTES
// ---------------------------------------------------------------------------
app.post('/api/courses/:id/certificate', requireAuth, (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const enrollment = dbGet('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });
    if (!enrollment.completed_at) return res.status(400).json({ error: 'Course not yet completed' });

    const existing = dbGet('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    if (existing) return res.json({ certificate: existing });

    const code = `CERT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    dbRun('INSERT INTO certificates (user_id, course_id, certificate_code) VALUES (?, ?, ?)', [req.user.id, courseId, code]);
    const certificate = dbGet('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?', [req.user.id, courseId]);
    res.status(201).json({ certificate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/certificates/:code', (req, res) => {
  try {
    const cert = dbGet(`
      SELECT cert.*, u.name as user_name, c.title as course_title
      FROM certificates cert
      JOIN users u ON cert.user_id = u.id
      JOIN courses c ON cert.course_id = c.id
      WHERE cert.certificate_code = ?
    `, [req.params.code]);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ certificate: cert });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/my/certificates', requireAuth, (req, res) => {
  try {
    const certs = dbAll(`
      SELECT cert.*, c.title as course_title
      FROM certificates cert
      JOIN courses c ON cert.course_id = c.id
      WHERE cert.user_id = ?
      ORDER BY cert.issued_at DESC
    `, [req.user.id]);
    res.json({ certificates: certs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: SEND ANNOUNCEMENT EMAIL
// ---------------------------------------------------------------------------
// Send a one-off email to a subset of users (or all). Resend has rate limits;
// we send sequentially with small batches to stay well under them.
app.post('/api/admin/announcements', ...requireRole('admin'), async (req, res) => {
  try {
    const { subject, message, audience, course_id, action_label, action_url } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }
    if (!emailLib.isConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Set RESEND_API_KEY in Railway.' });
    }

    let users = [];
    if (audience === 'self') {
      // Test send: just to the requesting admin
      users = dbAll('SELECT id, name, email FROM users WHERE id = ?', [req.user.id]);
    } else if (audience === 'enrolled' && course_id) {
      users = dbAll(`
        SELECT DISTINCT u.id, u.name, u.email
        FROM users u
        JOIN enrollments e ON e.user_id = u.id
        WHERE e.course_id = ?
      `, [parseInt(course_id)]);
    } else if (audience === 'learners') {
      users = dbAll('SELECT id, name, email FROM users WHERE role = ?', ['learner']);
    } else {
      users = dbAll('SELECT id, name, email FROM users');
    }

    let sent = 0, failed = 0;
    const errors = [];
    for (const u of users) {
      const result = await emailLib.sendAnnouncement({
        to: u.email,
        subject,
        message, // HTML allowed
        actionLabel: action_label,
        actionUrl: action_url,
      });
      if (result.ok) sent++;
      else { failed++; errors.push(`${u.email}: ${result.error}`); }
      // Small pacing to avoid hitting Resend's free-tier rate limit (~10/sec)
      await new Promise(r => setTimeout(r, 120));
    }

    res.json({ sent, failed, total: users.length, errors: errors.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: COURSE COMPLETION TRACKING
// ---------------------------------------------------------------------------

// Per-course breakdown: for a given course, list every enrolled user with
// their completion status, lesson progress count, and quiz results.
app.get('/api/admin/courses/:courseId/progress', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const course = dbGet('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const totalLessons = dbGet('SELECT COUNT(*) as c FROM lessons WHERE course_id = ?', [courseId]).c;

    const rows = dbAll(`
      SELECT
        u.id            AS user_id,
        u.name          AS user_name,
        u.email         AS user_email,
        u.role          AS user_role,
        e.enrolled_at   AS enrolled_at,
        e.completed_at  AS completed_at,
        (SELECT COUNT(*) FROM lesson_progress lp
           WHERE lp.user_id = u.id AND lp.course_id = ? AND lp.completed = 1)
          AS lessons_completed,
        (SELECT COUNT(*) FROM quiz_attempts qa
           JOIN quizzes q ON qa.quiz_id = q.id
           JOIN lessons l ON q.lesson_id = l.id
           WHERE qa.user_id = u.id AND l.course_id = ? AND qa.passed = 1)
          AS quizzes_passed
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      WHERE e.course_id = ?
      ORDER BY e.enrolled_at DESC
    `, [courseId, courseId, courseId]);

    const enrollments = rows.map(r => ({
      ...r,
      total_lessons: totalLessons,
      progress_percent: totalLessons === 0 ? 0 : Math.round((r.lessons_completed / totalLessons) * 100),
      is_completed: !!r.completed_at,
    }));

    const summary = {
      total_enrolled: enrollments.length,
      total_completed: enrollments.filter(e => e.is_completed).length,
      total_in_progress: enrollments.filter(e => !e.is_completed && e.lessons_completed > 0).length,
      total_not_started: enrollments.filter(e => !e.is_completed && e.lessons_completed === 0).length,
      completion_rate: enrollments.length === 0 ? 0
        : Math.round((enrollments.filter(e => e.is_completed).length / enrollments.length) * 100),
      average_progress: enrollments.length === 0 ? 0
        : Math.round(enrollments.reduce((sum, e) => sum + e.progress_percent, 0) / enrollments.length),
    };

    res.json({ course: withStatus(course), total_lessons: totalLessons, summary, enrollments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All-courses overview: completion rate per course
app.get('/api/admin/progress/overview', ...requireRole('admin', 'instructor'), (req, res) => {
  try {
    const isInstructor = req.user.role === 'instructor';
    const courseFilter = isInstructor ? 'WHERE c.instructor_id = ?' : '';
    const params = isInstructor ? [req.user.id] : [];

    const rows = dbAll(`
      SELECT
        c.id, c.title, c.is_published,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) AS total_lessons,
        (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) AS total_enrolled,
        (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND completed_at IS NOT NULL) AS total_completed
      FROM courses c
      ${courseFilter}
      ORDER BY c.updated_at DESC
    `, params);

    const courses = rows.map(r => ({
      id: r.id,
      title: r.title,
      status: r.is_published ? 'published' : 'draft',
      total_lessons: r.total_lessons,
      total_enrolled: r.total_enrolled,
      total_completed: r.total_completed,
      completion_rate: r.total_enrolled === 0 ? 0
        : Math.round((r.total_completed / r.total_enrolled) * 100),
    }));

    res.json({ courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DASHBOARD STATS
// ---------------------------------------------------------------------------
app.get('/api/dashboard/stats', requireAuth, (req, res) => {
  try {
    const stats = {};

    if (req.user.role === 'admin') {
      stats.total_users = dbGet('SELECT COUNT(*) as c FROM users').c;
      stats.total_courses = dbGet('SELECT COUNT(*) as c FROM courses').c;
      stats.published_courses = dbGet('SELECT COUNT(*) as c FROM courses WHERE is_published = 1').c;
      stats.total_enrollments = dbGet('SELECT COUNT(*) as c FROM enrollments').c;
      stats.total_completions = dbGet('SELECT COUNT(*) as c FROM enrollments WHERE completed_at IS NOT NULL').c;
      stats.total_certificates = dbGet('SELECT COUNT(*) as c FROM certificates').c;
      stats.recent_enrollments = dbAll(`
        SELECT e.*, u.name as user_name, c.title as course_title
        FROM enrollments e
        JOIN users u ON e.user_id = u.id
        JOIN courses c ON e.course_id = c.id
        ORDER BY e.enrolled_at DESC LIMIT 10
      `);
    } else if (req.user.role === 'instructor') {
      stats.my_courses = dbGet('SELECT COUNT(*) as c FROM courses WHERE instructor_id = ?', [req.user.id]).c;
      stats.total_enrollments = dbGet(`
        SELECT COUNT(*) as c FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE c.instructor_id = ?
      `, [req.user.id]).c;
      stats.total_completions = dbGet(`
        SELECT COUNT(*) as c FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE c.instructor_id = ? AND e.completed_at IS NOT NULL
      `, [req.user.id]).c;
      stats.recent_enrollments = dbAll(`
        SELECT e.*, u.name as user_name, c.title as course_title
        FROM enrollments e
        JOIN users u ON e.user_id = u.id
        JOIN courses c ON e.course_id = c.id
        WHERE c.instructor_id = ?
        ORDER BY e.enrolled_at DESC LIMIT 10
      `, [req.user.id]);
    } else {
      stats.enrolled_courses = dbGet('SELECT COUNT(*) as c FROM enrollments WHERE user_id = ?', [req.user.id]).c;
      stats.completed_courses = dbGet('SELECT COUNT(*) as c FROM enrollments WHERE user_id = ? AND completed_at IS NOT NULL', [req.user.id]).c;
      stats.certificates_earned = dbGet('SELECT COUNT(*) as c FROM certificates WHERE user_id = ?', [req.user.id]).c;
      stats.lessons_completed = dbGet('SELECT COUNT(*) as c FROM lesson_progress WHERE user_id = ? AND completed = 1', [req.user.id]).c;
    }

    res.json({ stats, role: req.user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function start() {
  const SQL = await initSqlJs();

  // Load existing DB or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  initDatabase();
  seedAdmin();
  saveDatabase();

  // Save on exit
  process.on('SIGINT', () => { saveDatabase(); process.exit(0); });
  process.on('SIGTERM', () => { saveDatabase(); process.exit(0); });
  process.on('exit', () => { try { saveDatabase(); } catch {} });

  app.listen(PORT, () => {
    console.log(`LMS server running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
